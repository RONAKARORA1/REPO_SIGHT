/**
 * POST /api/auth/login
 * 
 * Expected JSON body:
 *   { email: string, password: string }
 * 
 * On success:
 *   - Verifies credentials
 *   - Returns a JWT in an HTTP‑only cookie and a minimal user object
 *   - Status 200
 * 
 * On error:
 *   - 400 if missing fields
 *   - 401 if email not found or password incorrect
 *   - 500 for unexpected errors
 */

import { NextResponse } from 'next/server';
import { comparePassword } from '../../lib/auth';
import { sql } from '@vercel/postgres';

export const POST = async (request: Request): Promise<NextResponse> => {
  try {
    const body = await request.json();
    const { email, password } = body;

    // ----- Basic validation -----
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email is required' },
        { status: 400 }
      );
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      );
    }

    // ----- Look up user by email (case‑insensitive) -----
    const result = await sql`
      SELECT id, email, password_hash
      FROM users
      WHERE email = ${email.toLowerCase()}
    `;

    if (result.rowCount === 0) {
      // Do not reveal whether the email exists – generic message
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const user = result.rows[0];

    // ----- Verify password -----
    const passwordValid = await comparePassword(password, user.password_hash);
    if (!passwordValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // ----- Generate JWT and set cookie -----
    const { generateJwt, setAuthCookie } = await import('../../lib/auth');
    const token = generateJwt(user.id, user.email);
    const res = NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          // Optionally include created_at if you select it
        },
      },
      { status: 200 }
    );
    setAuthCookie(res, token);
    return res;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
};
