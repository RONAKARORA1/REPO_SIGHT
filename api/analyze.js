// api/analyze.js
//
// POST /api/analyze
// Body: { "repoUrl": "https://github.com/<owner>/<repo>" }
//
// Downloads the repo's tarball (public repos only, tries `main` then
// `master`), runs the prebuilt CMA binary against it, and stores the
// resulting report JSON in Supabase Storage under the `scans` bucket
// (same bucket frontend/lib/storage.ts already uses) at `${scanId}.json`.
//
// This is intentionally synchronous: for a typical solo-dev repo the
// whole thing (download + analyze) finishes in a few seconds, so we skip
// building a job queue for the MVP. If you outgrow this (very large
// repos, frequent timeouts), the next step is to make this endpoint just
// enqueue work and have a separate worker do the analysis, with this
// route immediately returning a QUEUED status instead.
//
// Root-level Vercel Serverless Function (classic (req, res) handler) --
// deliberately NOT a Next.js app/api/*/route.ts, since this repo has no
// working Next.js build yet. Vercel auto-detects any api/**/*.js file at
// the project root as a function regardless of framework preset.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const CMA_BINARY = join(process.cwd(), "backend", "bin", "linux-x64-cma");
const ANALYZE_TIMEOUT_MS = 45_000;

function parseGithubUrl(repoUrl) {
  const m = String(repoUrl || "")
    .trim()
    .match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?(?:[?#].*)?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/**
 * Tries `main` then `master`. Returns the branch name that worked, or
 * null if the repo couldn't be found on either.
 */
async function downloadTarball(owner, repo, destTarPath) {
  for (const branch of ["main", "master"]) {
    const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${branch}`;
    const res = await fetch(url);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(destTarPath, buf);
      return branch;
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const parsed = parseGithubUrl(req.body?.repoUrl);
  if (!parsed) {
    res.status(400).json({
      error: "Provide a valid public GitHub repo URL, e.g. https://github.com/owner/repo",
    });
    return;
  }

  const scanId = randomUUID();
  const workDir = join("/tmp", `scan-${scanId}`);
  const tarPath = join("/tmp", `scan-${scanId}.tar.gz`);
  const srcDir = join(workDir, "src");
  const reportPath = join(workDir, "report.json");

  try {
    await mkdir(srcDir, { recursive: true });

    const branch = await downloadTarball(parsed.owner, parsed.repo, tarPath);
    if (!branch) {
      res.status(404).json({
        error: `Could not find "${parsed.owner}/${parsed.repo}" on GitHub (checked main and master). Make sure the repo is public.`,
      });
      return;
    }

    await execFileAsync("tar", ["-xzf", tarPath, "-C", srcDir, "--strip-components=1"]);

    let cmaResult;
    try {
      cmaResult = await execFileAsync(CMA_BINARY, [srcDir, "--json", reportPath], {
        timeout: ANALYZE_TIMEOUT_MS,
      });
    } catch (cmaErr) {
      const stderr = String(cmaErr?.stderr || "");
      if (stderr.includes("No recognized source files found")) {
        res.status(400).json({
          error: "No supported source files (C++, Python, or Java) found in this repository.",
        });
        return;
      }
      throw cmaErr;
    }
    void cmaResult;

    const report = JSON.parse(await readFile(reportPath, "utf8"));

    const payload = {
      status: "COMPLETED",
      scanId,
      projectName: `${parsed.owner}/${parsed.repo}`,
      createdAt: new Date().toISOString(),
      ...report,
    };

    const { error: uploadError } = await supabase.storage
      .from("scans")
      .upload(`${scanId}.json`, JSON.stringify(payload), {
        contentType: "application/json",
        upsert: true,
      });
    if (uploadError) throw uploadError;

    res.status(200).json({ scanId });
  } catch (err) {
    console.error("Analyze error:", err);
    const message =
      err?.code === "ETIMEDOUT" || err?.killed
        ? "Analysis timed out -- the repo may be too large for this endpoint's current limit."
        : err?.message || "Analysis failed.";
    res.status(500).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    await rm(tarPath, { force: true }).catch(() => {});
  }
}
