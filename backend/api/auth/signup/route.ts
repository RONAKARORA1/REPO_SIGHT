/**
 * POST /api/auth/signup
 * 
 * Expected JSON body:
 *   { email: string, password: string }
 * 
 * On success:
 *   - Creates a new user (if email not already registered)
 *   - Returns a JWT in an HTTP‑only cookie and a minimal user object
 *   - Status 201
 * 
 * On error:
 *   - 400 if missing fields or invalid email
 *   - 409 if email already exists
 *   - 500 for unexpected errors
 */

import { NextResponse } from 'next/server';
import { hashPassword } from '../../lib/auth';
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
    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    // ----- Check if user already exists -----
    const existingUser = await sql`
      SELECT id FROM users WHERE email = ${email.toLowerCase()}
    `;
    if (existingUser.rowCount > 0) {
      return NextResponse.json(
        { error: 'Email already registered' },
        { status: 409 }
      );
    }

    // ----- Hash password and insert user -----
    const passwordHash = await hashPassword(password);
    const result = await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${email.toLowerCase()}, ${passwordHash})
      RETURNING id, email, created_at
    `;

    const user = result.rows[0];

    // ----- Generate JWT and set cookie -----
    const { generateJwt, setAuthCookie } = await import('../../lib/auth');
    const token = generateJwt(user.id, user.email);
    const res = NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          created_at: user.created_at,
        },
      },
      { status: 201 }
    );
    setAuthCookie(res, token);
    return res;
  } catch (err) {
    console.error('Signup error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
};
