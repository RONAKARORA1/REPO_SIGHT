/* frontend/app/api/scans/[scanId]/route.ts */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { fetchBlob } from '@/lib/storage';

export const GET = async (
  req: Request,
  { params }: { params: { scanId: string } }
) => {
  const { rows } = await sql`
    SELECT s.status, s.error_message, s.json_blob_id, s.html_blob_id,
           p.id AS project_id, p.name AS project_name
    FROM scans s
    JOIN projects p ON s.project_id = p.id
    WHERE s.id = ${scanId}
  `;
  if (rows.length === 0) return new Response('Not found', { status: 404 });

  const scan = rows[0];
  if (scan.status === 'QUEUED' || scan.status === 'PROCESSING') {
    return NextResponse.json({ status: scan.status });
  }
  if (scan.status === 'FAILED') {
    return NextResponse.json(
      { status: 'FAILED', errorMessage: scan.error_message ?? 'Unknown' },
      { status: 200 }
    );
  }
  if (scan.status === 'COMPLETED') {
    if (!scan.json_blob_id) {
      return NextResponse.json(
        { error: 'Missing result blob' },
        { status: 500 }
      );
    }
    const jsonBuf = await fetchBlob(scan.json_blob_id as string);
    const json = JSON.parse(jsonBuf);
    return NextResponse.json(
      {
        status: 'COMPLETED',
        scanId: scan.id,
        projectId: scan.project_id,
        projectName: scan.project_name,
        ...json // spreads project, files, hotspots, violations from the CMA JSON
      },
      { status: 200 }
    );
  }
  return new Response('Unknown status', { status: 500 });
};
