/**
 * POST /api/scan/analyze
 * 
 * Background Function that performs the actual CMA analysis.
 * 
 * Expected JSON body:
 *   { scanId: string }
 * 
 * The function:
 *   1. Retrieves the scan record from Postgres (to get the blob ID of the uploaded ZIP).
 *   2. Downloads the ZIP from Vercel Blob Storage.
 *   3. Calls `processAnalysis` (from lib/analysis) which:
 *        - Unzips the source,
 *        - Runs the pre‑compiled CMA binary,
 *        - Persists JSON/HTML reports to Blob Storage,
 *        - Updates the scan record with status COMPLETED/FAILED.
 *   4. Returns a simple 200 OK on success (the client polls /api/scans/[id] for status).
 * 
 * This route is configured in vercel.json as a Background Function with a 15‑minute maxDuration.
 */

import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { fetchBlob } from '../../lib/storage';
import { processAnalysis } from '../../lib/analysis';

// Background Functions can run up to 15 minutes on Vercel Pro/Enterprise.
// We keep the config here for clarity; the actual limit is also set in vercel.json.
export const config = {
  maxDuration: 900, // 15 minutes
};

export const POST = async (request: Request): Promise<NextResponse> => {
  try {
    const body = await request.json();
    const { scanId } = body;

    if (!scanId || typeof scanId !== 'string' || scanId.trim() === '') {
      return NextResponse.json(
        { error: 'scanId is required and must be a non‑empty string' },
        { status: 400 }
      );
    }

    // ----- 1. Get scan record and the blob ID of the uploaded ZIP -----
    const scanResult = await sql`
      SELECT
        s.id,
        s.blob_id,
        p.user_id
      FROM scans s
      JOIN projects p ON s.project_id = p.id
      WHERE s.id = ${scanId}
    `;

    if (scanResult.rowCount === 0) {
      return NextResponse.json(
        { error: 'Scan not found' },
        { status: 404 }
      );
    }

    const scan = scanResult.rows[0];
    const blobId = scan.blob_id as string;

    // ----- 2. Download the uploaded ZIP from Blob Storage -----
    let zipBuffer: Buffer;
    try {
      const blob = await fetchBlob(blobId);
      // The blob object from @vercel/blob has a streaming() method that yields Uint8Array chunks.
      const chunks: Uint8Array[] = [];
      for await (const chunk of blob.streaming()) {
        chunks.push(chunk);
      }
      zipBuffer = Buffer.concat(chunks);
    } catch (err) {
      console.error('Failed to fetch upload blob:', err);
      // Mark scan as failed so the client can see an error.
      await sql`
        UPDATE scans
        SET status = 'FAILED',
            error_message = 'Could not retrieve uploaded source',
            completed_at = NOW()
        WHERE id = ${scanId}
      `;
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    // ----- 3. Run the analysis (this will update the scan record internally) -----
    try {
      await processAnalysis(scanId, zipBuffer);
      // processAnalysis already updates the scan status to COMPLETED or FAILED.
      // We just return a success response; the client will poll /api/scans/[id] for the final state.
      return NextResponse.json({ message: 'Analysis started' }, { status: 200 });
    } catch (err) {
      // processAnalysis already marked the scan as FAILED and logged the error.
      // We still return a 500 to indicate something went wrong in the background function.
      console.error('Background analysis error:', err);
      return NextResponse.json(
        { error: 'Internal server error during analysis' },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error('Unexpected error in /api/scan/analyze:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
};
