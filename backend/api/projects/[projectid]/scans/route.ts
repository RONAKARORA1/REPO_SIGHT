/**
 * POST /api/projects/[projectId]/scans
 * 
 * Expected JSON body:
 *   { uploadId: string }   // the blob ID returned by /api/uploads
 * 
 * On success:
 *   - Creates a new scan record with status QUEUED
 *   - Triggers the background analysis function (fire‑and‑forget)
 *   - Returns the newly created scan object
 *   - Status 201
 * 
 * On error:
 *   - 400 if missing/invalid fields
 *   - 404 if project not found or access denied
 *   - 500 for unexpected errors
 */

import { NextResponse } from 'next/server';
import { requireAuth, getUserFromRequest } from '../../lib/auth';
import { sql } from '@vercel/postgres';
import { v4 as uuidv4 } from 'uuid';

export const POST = requireAuth(
  async (
    request: Request,
    { params }: { params: { projectId: string } }
  ): Promise<NextResponse> => {
    try {
      const user = getUserFromRequest(request);
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // ----- Verify project belongs to user -----
      const projectCheck = await sql`
        SELECT id FROM projects
        WHERE id = ${params.projectId} AND user_id = ${user.userId}
      `;
      if (projectCheck.rowCount === 0) {
        return NextResponse.json(
          { error: 'Project not found or access denied' },
          { status: 404 }
        );
      }

      // ----- Parse request body -----
      const body = await request.json();
      const { uploadId } = body;

      if (!uploadId || typeof uploadId !== 'string' || uploadId.trim() === '') {
        return NextResponse.json(
          { error: 'uploadId is required and must be a non‑empty string' },
          { status: 400 }
        );
      }

      // ----- Create scan record -----
      const scanId = uuidv4();
      const { rows } = await sql`
        INSERT INTO scans (
          id,
          project_id,
          status,
          blob_id,
          created_at
        )
        VALUES (
          ${scanId},
          ${params.projectId},
          'QUEUED',
          ${uploadId},
          NOW()
        )
        RETURNING id, project_id, status, blob_id, created_at
      `;

      const newScan = rows[0];

      // ----- Trigger background analysis (fire‑and‑forget) -----
      // Build the internal URL for the background function.
      // Vercel provides VERCEL_URL (e.g., project-name.vercel.app) in env.
      let baseUrl = process.env.VERCEL_URL;
      if (!baseUrl) {
        // Fallback for local development: use the request's host.
        const host = request.headers.get('host');
        const proto = request.headers.get('x-forwarded-proto') ?? 'http';
        baseUrl = `${proto}://${host}`;
      }
      // Ensure we have a protocol.
      if (!baseUrl.startsWith('http')) {
        baseUrl = `https://${baseUrl}`;
      }
      const internalUrl = `${baseUrl}/api/scan/analyze`;

      // Fire‑and‑forget: we do not await the response.
      void fetch(internalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId: scanId }),
        // Keep alive? Not needed.
      }).catch((err) => {
        // Log but do not affect the response to the client.
        console.error('Failed to trigger background analysis:', err);
      });

      // ----- Respond with the new scan -----
      return NextResponse.json({ scan: newScan }, { status: 201 });
    } catch (err) {
      console.error('POST /api/projects/[projectId]/scans error:', err);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  }
);
