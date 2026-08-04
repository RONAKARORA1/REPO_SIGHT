/**
 * GET /api/health
 * 
 * Simple health check endpoint.
 * Returns 200 OK with a JSON payload indicating the service is up.
 * Can be used by Vercel's built‑in monitoring or external uptime checks.
 */

import { NextResponse } from 'next/server';

export const GET = async (): Promise<NextResponse> => {
  return NextResponse.json(
    { status: 'ok', timestamp: new Date().toISOString() },
    { status: 200 }
  );
};
