/**
 * GET  /api/projects/[projectId]
 * PUT  /api/projects/[projectId]
 * DELETE /api/projects/[projectId]
 * 
 * All endpoints require a valid JWT cookie and ensure the project belongs to the authenticated user.
 */

import { NextResponse } from 'next/server';
import { requireAuth, getUserFromRequest } from '../../lib/auth';
import { sql } from '@vercel/postgres';

/**
 * Helper: verify that a project belongs to the given user.
 * Returns the project row if found and owned, otherwise null.
 */
async function getProjectIfOwned(
  projectId: string,
  userId: string
) {
  const { rows = await sql`SELECT
      id,
       
        name
      description,
      created_at
      FROM projects
      WHERE id = ${projectId} AND user_id = ${userId}
    `;
  return rows[0] ?? null;
}

export const GET = requireAuth(async (request, { params }: { params: { projectId: string } }) => {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const project = await getProjectIfOwned(params.projectId, user.userId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or access denied' },
        { status: 404 }
      );
    }

    return NextResponse.json({ project }, { status: 200 });
  } catch (err) {
    console.error('GET /api/projects/[projectId] error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

export const PUT = requireAuth(async (request, { params }: { params: { projectId: string } }) => {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const project = await getProjectIfOwned(params.projectId, user.userId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or access denied' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { name, description } = body;

    // Validation
    if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
      return NextResponse.json(
        { error: 'Project name must be a non‑empty string if provided' },
        { status: 400 }
      );
    }
    if (description !== undefined && typeof description !== 'string') {
      return NextResponse.json(
        { error: 'Project description must be a string if provided' },
        { status: 400 }
      );
    }

    const updateFields: string[] = [];
    const values: any[] = [];
    if (name !== undefined) {
      updateFields.push(`name = $${updateFields.length + 1}`);
      values.push(name.trim());
    }
    if (description !== undefined) {
      updateFields.push(`description = $${updateFields.length + 1}`);
      values.push(description);
    }
    if (updateFields.length === 0) {
      // Nothing to update
      return NextResponse.json({ project }, { status: 200 });
    }

    const query = `
      UPDATE projects
      SET ${updateFields.join(', ')}
      WHERE id = $${updateFields.length + 1}
      RETURNING id, name, description, created_at
    `;
    values.push(params.projectId);

    const { rows } = await sql(query, values);
    const updated = rows[0];

    return NextResponse.json({ project: updated }, { status: 200 });
  } catch (err) {
    console.error('PUT /api/projects/[projectId] error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

export const DELETE = requireAuth(async (request, { params }: { params: { projectId: string } }) => {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const project = await getProjectIfOwned(params.projectId, user.userId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or access denied' },
        { status: 404 }
      );
    }

    // Delete the project.
    // If your foreign key from scans to projects is set to ON DELETE CASCADE,
    // related scans will be removed automatically. Otherwise you may want to
    // delete scans first here.
    await sql`DELETE FROM projects WHERE id = ${params.projectId}`;

    return NextResponse.json({ message: 'Project deleted' }, { status: 200 });
  } catch (err) {
    console.error('DELETE /api/projects/[projectId] error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
