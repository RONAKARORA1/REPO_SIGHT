/**
 * backend/lib/analysis.ts
 * 
 * Utilities for running the REPO‑SIGHT/CMA binary, handling uploads,
 * invoking the analysis, and persisting results to Vercel Blob and Postgres.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { join, sep } from 'path';
import { mkdir, rm, readdir, stat } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { uploadBlob, fetchBlob, deleteBlob, listBlobsWithPrefix } from './storage';
import { sql } from '@vercel/postgres';

const execPromise = promisify(exec);

/**
 * Path to the pre‑compiled CMA binary (Linux x64) that lives in
 * `backend/bin/linux-x64-cma`.  Vercel bundles this file via vercel.json's
 * includeFiles setting.
 */
const CMA_BINARY_PATH = join(process.cwd(), 'backend', 'bin', 'linux-x64-cma');

/**
 * Temporary directory prefix used for each analysis run.
 * We create a unique folder under `/tmp` to avoid collisions.
 */
function getTempDir(scanId: string): string {
  return join('/tmp', `cma-analysis-${scanId}`);
}

/**
 * Ensure a directory exists (recursively).
 */
async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/**
 * Clean up a temporary directory (best‑effort).
 */
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`Failed to clean up temp dir ${dir}:`, err);
  }
}

/**
 * Run the CMA binary on a given directory containing source code.
 * @param sourceDir - Absolute path to the folder with the source files.
 * @returns Promise<{ json: any; html: string }> The parsed JSON report and raw HTML.
 * @throws If the binary fails or times out.
 */
export async function runCMAAnalysis(sourceDir: string): Promise<{
  json: any;
  html: string;
}> {
  // Output files that CMA will generate
  const jsonOut = join(sourceDir, 'report.json');
  const htmlOut = join(sourceDir, 'report.html');

  // Build the command: <binary> <sourceDir> --json <jsonOut> --html <htmlOut>
  const cmd = `"${CMA_BINARY_PATH}" "${sourceDir}" --json "${jsonOut}" --html "${htmlOut}"`;

  // We allow up to 14 minutes for the analysis; the Background Function
  // itself has a 15‑minute limit, leaving 1 minute for cleanup/upload.
  const { stdout, stderr } = await execPromise(cmd, {
    timeout: 14 * 60 * 1000, // 14 minutes in ms
    maxBuffer: 10 * 1024 * 1024, // 10 MB buffer for stderr/stdout
  });

  if (stderr) {
    // Non‑fatal warnings (e.g., skipped files) are printed to stderr by CMA.
    // We log them but do not treat them as failures.
    console.warn('CMA stderr:', stderr.slice(0, 1000)); // truncate huge output
  }

  // Read the generated reports
  const [jsonBuffer, htmlBuffer] = await Promise.all([
    promisify(require('fs').readFile)(jsonOut, 'utf8'),
    promisify(require('fs').readFile)(htmlOut, 'utf8'),
  ]);

  // Parse JSON (CMA already outputs valid JSON)
  const json = JSON.parse(jsonBuffer);

  return { json, html: htmlBuffer };
}

/**
 * Handle an upload request: store the uploaded ZIP in Blob Storage,
 * extract it to a temp directory, run CMA, store results, and return
 * the IDs needed to retrieve them later.
 * 
 * This function is meant to be called from the Background Function
 * (`
