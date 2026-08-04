/**
 * GET  /api/projects
 * POST /api/projects
 * 
 * GET: Returns a list of projects belonging to the authenticated user.
 * POST: Creates a new project for the authenticated user.
 * 
 * Both endpoints require a valid JWT cookie (handled by requireAuth middleware).
 */

import { NextResponse } from 'next/server';
import { requireAuth, getUserFromRequest } from '../../lib/auth';
import { sql } from '@vercel/postgres';

/**
 * GET /api/projects
 * Query parameters (optional):
 *   - limit: number (default 20)
 *   - offset: number (default 0)
 */
export const GET = requireAuth(async (request) => {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      // Should never happen because requireAuth already validated,
      // but we keep the check for safety.
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const { rows } = await sql`
      SELECT
        id,
        name,
        description,
        created_at
      FROM projects
      WHERE user_id = ${user.userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return NextResponse.json({ projects: rows }, { status: 200 });
  } catch (err) {
    console.error('GET /api/projects error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/projects
 * Expected JSON body:
 *   { name: string, description?: string }
 * 
 * On success:
 *   - Returns the created project object
 *   - Status 201
 * 
 * On error:
 *   - 400 if missing or invalid fields
 *   - 500 for unexpected errors
 */
export const POST = requireAuth(async (request) => {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json(
        { error: 'Project name is required and must be a non‑empty string' },
        { status: 400 }
      );
    }
    if (description !== undefined && typeof description !== 'string') {
      return NextResponse.json(
        { error: 'Project description must be a string if provided' },
        { status: 400 }
      );
    }

    const { rows } = await sql`
      INSERT INTO projects (user_id, name, description)
      VALUES (${user.userId}, ${name.trim()}, ${description ?? null})
      RETURNING id, name, description, created_at
    `;

    const project = rows[0];
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    console.error('POST /api/projects error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
