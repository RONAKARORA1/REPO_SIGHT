// frontend/app/api/scans/[scanId]/analyze/route.ts
import { exec } from 'child_process';
import { join } from 'path';
import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { sql } from '@/lib/db';
import { uploadBlob, fetchBlob } from '@/lib/storage';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

// -------------------------------------------------------------------
// CONFIG
// -------------------------------------------------------------------
export const config = { maxDuration: 300 }; // Hobby‑safe (5 min)
export const maxDuration = 60;
// -------------------------------------------------------------------
// HELPERS
// -------------------------------------------------------------------
async function ensureDir(dir: string) { await mkdir(dir, { recursive: true }); }
async function readJson<T>(path: string): Promise<T> {
  const buf = await readFile(path, 'utf8');
  return JSON.parse(buf) as T;
}
async function writeJson(path: string, obj: any) {
  await writeFile(path, JSON.stringify(obj, null, 2), 'utf8');
}

// -------------------------------------------------------------------
// MAIN HANDLER
// -------------------------------------------------------------------
export const POST = async (req: Request): Promise<NextResponse> => {
  try {
    const { scanId } = await req.json();
    if (!scanId || typeof scanId !== 'string') {
      return NextResponse.json({ error: 'Invalid scanId' }, { status: 400 });
    }

    // 1������ Load scan record
    const scanRes = await sql`
      SELECT s.id, s.status, s.total_files, s.processed_files,
             s.blob_id, s.json_blob_id, s.html_blob_id,
             p.id AS project_id
      FROM scans s
      JOIN projects p ON s.project_id = p.id
      WHERE s.id = ${scanId}
    `;
    if (scanRes.rowCount === 0) {
      return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    }
    const scan = scanRes.rows[0];

    // Already finished → just return current state
    if (scan.status === 'COMPLETED' || scan.status === 'FAILED') {
      return NextResponse.json({
        status: scan.status,
        processedFiles: scan.processed_files,
        totalFiles: scan.total_files,
      });
    }

    // Mark as PROCESSING if we are still QUEUED
    if (scan.status === 'QUEUED') {
      await sql`
        UPDATE scans
        SET status = 'PROCESSING',
            started_at = NOW()
        WHERE id = ${scanId}
      `;
    }

    // 2������ Prepare a temporary workspace
    const workDir = join('/tmp', `scan-${scanId}-${Date.now()}`);
    await ensureDir(workDir);

    // 3������ Download the source ZIP and unpack it
    const zipBlob = await fetchBlob(scan.blob_id as string);
    const zipPath = join(workDir, 'source.zip');
    await writeFile(zipPath, zipBlob);
    await exec(`unzip -qo ${zipPath} -d ${workDir}`);

    // 4������ List source files we care about
    const allFiles = await readdir(workDir, { withFileTypes: true });
    const srcFiles = allFiles
      .filter(f => f.isFile() && /\.(c|cc|cpp|cxx|py|java)$/i.test(f.name))
      .map(f => join(workDir, f.name));

    // 5������ Determine what still needs to be done
    const startIdx = scan.processed_files ?? 0;
    const remaining = srcFiles.slice(startIdx);
    if (remaining.length === 0) {
      // Nothing left → finalise
      await finalizeScan(scanId, workDir);
      return NextResponse.json({
        status: 'COMPLETED',
        processedFiles: scan.total_files,
        totalFiles: scan.total_files,
      });
    }

    // 6������ Process a *batch* of files (size tuned for Hobby tier)
    const BATCH_SIZE = 7; // tweak after you see logs
    const batch = remaining.slice(0, BATCH_SIZE);
    const batchPromises = batch.map(f => analyseSingleFile(f, workDir));
    const batchResults = await Promise.allSettled(batchPromises);

    // 7������ Collect successful results
    const newJson: any = { project: null, files: [] as any[], hotspots: { gitAvailable: false, files: [] }, violations: [] };
    const newHtmlParts: string[] = [];

    for (const res of batchResults) {
      if (res.status === 'fulfilled' && res.value) {
        const { json, html } = res.value;
        if (!newJson.project) newJson.project = json.project; // first file sets project‑level summary
        newJson.files = [...newJson.files, ...json.files];
        newJson.hotspots.files = [...newJson.hotspots.files, ...(json.hotspots?.files ?? [])];
        newJson.violations = [...newJson.violations, ...json.violations];
        newHtmlParts.push(html);
      } else {
        if (res.status === 'rejected')
          console.warn(`File analysis failed:`, res.reason);
      }
    }

    // 8������ Merge batch results into the running Blob storage
    const mergedJson = await mergeBlobJson(scan.json_blob_id, newJson);
    const mergedHtml = await mergeBlobHtml(scan.html_blob_id, newHtmlParts.join('\n'));

    await sql`
      UPDATE scans
      SET
        processed_files = ${scan.processed_files + batch.length},
        json_blob_id = ${mergedJson.uploadId},
        html_blob_id = ${mergedHtml.uploadId}
      WHERE id = ${scanId}
    `;

    // 9������ If work remains, tell the caller we are still processing
    const stillPending = remaining.length > BATCH_SIZE;
    return NextResponse.json({
      status: stillPending ? 'PROCESSING' : 'QUEUED', // QUEUED = “more work but not yet started”
      processedFiles: scan.processed_files + batch.length,
      totalFiles: scan.total_files,
    });
  } catch (err) {
    console.error('Background analysis error:', err);
    // Mark the scan as failed so the UI can show an error
    await sql`
      UPDATE scans
      SET status = 'FAILED',
          error_message = ${err instanceof Error ? err.message : String(err)},
          completed_at = NOW()
      WHERE id = ${scanId}
    `;
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
};

// -------------------------------------------------------------------
// Analyse a single file with the CMA binary
// -------------------------------------------------------------------
async function analyseSingleFile(
  filePath: string,
  workDir: string
): Promise<{ json: any; html: string } | null> {
  const jsonOut = join(workDir, 'file-report.json');
  const htmlOut = join(workDir, 'file-report.html');

  const cmaPath = join(process.cwd(), 'backend', 'bin', 'linux-x64-cma');
  const cmd = `"${cmaPath}" "${filePath}" --json "${jsonOut}" --html "${htmlOut}"`;

  try {
    // Give each file a comfortable timeout (e.g., 20 s). Adjust if needed.
    await exec(cmd, { timeout: 20_000 });
    const [jsonBuf, htmlBuf] = await Promise.all([
      readFile(jsonOut, 'utf8'),
      readFile(htmlOut, 'utf8')
    ]);
    return { json: JSON.parse(jsonBuf), html: htmlBuf };
  } catch (e) {
    console.warn(`Single‑file analysis failed for ${filePath}:`, e);
    return null;
  }
}

// -------------------------------------------------------------------
// Merge a new JSON payload into the existing Blob‑stored JSON
// -------------------------------------------------------------------
async function mergeBlobJson(
  existingBlobId: string | null,
  increment: any
): Promise<{ uploadId: string; url: string }> {
  let base: any = { project: null, files: [], hotspots: { gitAvailable: false, files: [] }, violations: [] };
  if (existingBlobId) {
    const buf = await fetchBlob(existingBlobId as string);
    base = JSON.parse(buf.toString());
  }
  // Merge
  if (!base.project) base.project = increment.project ?? base.project;
  base.files = [...base.files, ...increment.files];
  base.hotspots.files = [...base.hotspots.files, ...(increment.hotspots?.files ?? [])];
  base.violations = [...base.violations, ...increment.violations];

  const blob = await uploadBlob(
    `scan-merge-${Date.now()}-${uuidv4()}.json`,
    JSON.stringify(base, null, 2),
    { contentType: 'application/json' }
  );
  return { uploadId: blob.pathname, url: blob.url };
}

// -------------------------------------------------------------------
// Merge HTML parts (simple concatenation)
// -------------------------------------------------------------------
async function mergeBlobHtml(
  existingBlobId: string | null,
  newHtmlParts: string[]
): Promise<{ uploadId: string; url: string }> {
  let existing = '';
  if (existingBlobId) {
    const buf = await fetchBlob(existingBlobId as string);
    existing = buf.toString();
  }
  const combined = existing + '\n' + newHtmlParts.join('\n');
  const blob = await uploadBlob(
    `scan-merge-${Date.now()}-${uuidv4()}.html`,
    combined,
    { contentType: 'text/html' }
  );
  return { uploadId: blob.pathname, url: blob.url };
}

// -------------------------------------------------------------------
// Final step – when no files remain, just mark the scan COMPLETED
// -------------------------------------------------------------------
async function finalizeScan(scanId: string, workDir: string): Promise<void> {
  // Mark scan as COMPLETED (the Blobs already contain the merged data)
  await sql`
    UPDATE scans
    SET status = 'COMPLETED',
        completed_at = NOW()
    WHERE id = ${scanId}
  `;
  // Clean up the temporary workspace (best effort)
  try { await import('fs/promises').then(f => f.rm(workDir, { recursive: true, force: true })); } catch {}
}
