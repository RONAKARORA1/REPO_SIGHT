// api/analyze.js
//
// POST /api/analyze
// Body: { "repoUrl": "https://github.com/<owner>/<repo>" }
//
// Downloads the repo's tarball (public repos only, tries `main` then
// `master`), runs the prebuilt CMA binary against it, and stores the
// resulting report JSON in Supabase Storage under the `scans` bucket
// (same bucket frontend/lib/storage.ts already uses) at `${scanId}.json`.
import * as tar from "tar";
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

// vercel.json caps this function at maxDuration: 10 (seconds).
// Keep our own deadline below that limit so we can return a JSON error
// before Vercel force-kills the function.
const OVERALL_TIMEOUT_MS = 8_000;
const CMA_TIMEOUT_MS = 7_000;

class PipelineTimeoutError extends Error {}

function withDeadline(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(
        () =>
          reject(
            new PipelineTimeoutError(
              "Analysis pipeline exceeded its time budget"
            )
          ),
        ms
      );
      t.unref?.();
    }),
  ]);
}

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
async function runPipeline({
  parsed,
  tarPath,
  srcDir,
  reportPath,
  scanId,
  supabase,
}) {
  const branch = await downloadTarball(
    parsed.owner,
    parsed.repo,
    tarPath
  );

  if (!branch) {
    return {
      status: 404,
      body: {
        error: `Could not find "${parsed.owner}/${parsed.repo}" on GitHub (checked main and master). Make sure the repo is public.`,
      },
    };
  }

  await tar.x({
    file: tarPath,
    cwd: srcDir,
    strip: 1,
  });

  let cmaResult;

  try {
    cmaResult = await execFileAsync(
      CMA_BINARY,
      [srcDir, "--json", reportPath],
      {
        timeout: CMA_TIMEOUT_MS,
      }
    );
  } catch (cmaErr) {
    const stderr = String(cmaErr?.stderr || "");

    if (stderr.includes("No recognized source files found")) {
      return {
        status: 400,
        body: {
          error:
            "No supported source files (C++, Python, or Java) found in this repository.",
        },
      };
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

  return {
    status: 200,
    body: { scanId },
  };
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
  const supabase = getSupabase();

  await mkdir(srcDir, { recursive: true });

  const result = await withDeadline(
    runPipeline({
      parsed,
      tarPath,
      srcDir,
      reportPath,
      scanId,
      supabase,
    }),
    OVERALL_TIMEOUT_MS
  );
} catch (err) {
  console.error("Analyze error:", err);

  const timedOut =
    err instanceof PipelineTimeoutError ||
    err?.code === "ETIMEDOUT" ||
    err?.killed;

  const message = timedOut
    ? "Analysis timed out -- the repo may be too large for this endpoint's current limit."
    : err?.message || "Analysis failed.";

  res.status(500).json({ error: message });
}
  res.status(result.status).json(result.body);

  finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    await rm(tarPath, { force: true }).catch(() => {});
  }
}
