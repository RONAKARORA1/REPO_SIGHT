/**
 * GET /api/scans/[scanId]
 * 
 * Returns the current status of a scan.
 * If the scan is COMPLETED, also returns the full analysis report
 * (project metrics, files, hotspots, violations) that the dashboard
 * expects to render.
 * 
 * Requires a valid JWT cookie and ensures the scan belongs to the
 * authenticated user.
 */

import { NextResponse } from 'next/server';
import { requireAuth, getUserFromRequest } from '../../lib/auth';
import { sql } from '@vercel/postgres';
import { fetchBlob } from '../../lib/storage';

export const GET = requireAuth(
  async (
    request: Request,
    { params }: { params: { scanId: string } }
  ): Promise<NextResponse> => {
    try {
      const user = getUserFromRequest(request);
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // ----- Fetch scan record, ensuring it belongs to the user -----
      const scanResult = await sql`
        SELECT
          s.id,
          s.status,
          s.error_message,
          s.json_blob_id,
          s.html_blob_id,
          s.created_at,
          s.updated_at,
          p.id AS project_id,
          p.name AS project_name
        FROM scans s
        JOIN projects p ON s.project_id = p.id
        WHERE s.id = ${scanId}
          AND p.user_id = ${user.userId}
      `;

      if (scanResult.rowCount === 0) {
        return NextResponse.json(
          { error: 'Scan not found or access denied' },
          { status: 404 }
        );
      }

      const scan = scanResult.rows[0];

      // ----- Return based on status -----
      if (scan.status === 'QUEUED' || scan.status === 'PROCESSING') {
        return NextResponse.json(
          { status: scan.status },
          { status: 200 }
        );
      }

      if (scan.status === 'FAILED') {
        return NextResponse.json(
          {
            status: 'FAILED',
            errorMessage: scan.error_message ?? 'Unknown error',
          },
          { status: 200 }
        );
      }

      if (scan.status === 'COMPLETED') {
        if (!scan.json_blob_id) {
          return NextResponse.json(
            { error: 'Completed scan missing result blob' },
            { status: 500 }
          );
        }

        // Fetch the JSON report from Blob Storage
        let jsonReport: any;
        try {
          const buffer = await fetchBlob(scan.json_blob_id as string);
          jsonReport = JSON.parse(buffer.toString());
        } catch (err) {
          console.error('Failed to fetch JSON blob for scan:', err);
          return NextResponse.json(
            { error: 'Could not retrieve analysis results' },
            { status: 500 }
          );
        }

        // The JSON report from CMA already has the shape:
        // { project: {...}, files: [...], hotspots: {...}, violations: [...] }
        // We augment it with the scan status and IDs for the dashboard.
        const responsePayload = {
          status: 'COMPLETED',
          scanId: scan.id,
          projectId: scan.project_id,
          createdAt: scan.created_at,
          ...jsonReport, // spreads project, files, hotspots, violations
        };

        return NextResponse.json(responsePayload, { status: 200 });
      }

      // Fallback for any unexpected status
      return NextResponse.json(
        { error: `Unknown scan status: ${scan.status}` },
        { status: 500 }
      );
    } catch (err) {
      console.error('GET /api/scans/[scanId] error:', err);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  }
);
