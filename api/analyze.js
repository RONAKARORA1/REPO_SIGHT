// api/analyze.js
//
// POST /api/analyze
// Body: { "repoUrl": "https://github.com/<owner>/<repo>" }
//
// Downloads the repo's tarball (public repos only, tries `main` then
// `master`), runs the prebuilt CMA binary against it, and stores the
// resulting report JSON in Supabase Storage under the `scans` bucket
// (same bucket frontend/lib/storage.ts already uses) at `${scanId}.json`.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);

// Lazy init -- if the env vars are missing/wrong, this throws INSIDE the
// handler's try/catch (below) instead of crashing the whole module at
// cold start. A crashed module returns Vercel's raw platform error page
// (not JSON), which is what was breaking the frontend's res.json() call.
let _supabase;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Server misconfigured: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY " +
        "are not set for this environment in Vercel Project Settings."
      );
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

const CMA_BINARY = join(process.cwd(), "backend", "bin", "linux-x64-cma");
const ANALYZE_TIMEOUT_MS = 45_000;

function parseGithubUrl(repoUrl) {
  const m = String(repoUrl || "")
    .trim()
    .match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?(?:[?#].*)?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

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
    const supabase = getSupabase(); // throws clean Error if misconfigured

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
