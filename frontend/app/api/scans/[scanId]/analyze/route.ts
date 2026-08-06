/* frontend/app/api/scans/[scanId]/analyze/route.ts */
import { exec } from 'child_process';
import { join } from 'path';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { sql } from '@/lib/db';
import { uploadBlob, fetchBlob } from '@/lib/storage';
import { NextResponse } from 'next/server';

export const config = { maxDuration: 900 }; // 15 minutes

export const POST = async (req: Request) => {
  const { scanId } = await req.json();
  if (!scanId) return new Response('Missing scanId', { status: 400 });

  // 1������ Get the blobId of the uploaded ZIP from the scans table
  const { rows } = await sql`
    SELECT blob_id FROM scans WHERE id = ${scanId}
  `;
  if (rows.length === 0) return new Response('Scan not found', { status: 404 });
  const blobId = rows[0].blob_id as string;

  // 2������ Download the ZIP from Vercel Blob
  const zip = await fetchBlob(blobId);
  const tmpDir = `/tmp/scan-${scanId}`;
  await mkdir(tmpDir, { recursive: true });
  await writeFile(`${tmpDir}/source.zip`, zip);
  await exec(`unzip -qo ${tmpDir}/source.zip -d ${tmpDir}`);

  // 3������ Run the CMA binary
  const binPath = join(process.cwd(), 'backend', 'bin', 'linux-x64-cma');
  await exec(`"${binPath}" "${tmpDir}" --json /tmp/report.json --html /tmp/report.html`);

  // 4������ Persist results back to Blob
  const jsonBuf = await readFile('/tmp/report.json', 'utf8');
  const htmlBuf = await readFile('/tmp/report.html', 'utf8');

  const jsonBlob = await uploadBlob(
    `scan-${scanId}-report.json`,
    jsonBuf,
    { contentType: 'application/json' }
  );
  const htmlBlob = await uploadBlob(
    `scan-${scanId}-report.html`,
    htmlBuf,
    { contentType: 'text/html' }
  );

  // 5������ Mark scan as COMPLETED
  await sql`
    UPDATE scans
    SET status='COMPLETED',
        completed_at=NOW(),
        json_blob_id=${jsonBlob.uploadId},
        html_blob_id=${htmlBlob.uploadId}
    WHERE id=${scanId}
  `;

  return new Response('Analysis complete', { status: 200 });
};
