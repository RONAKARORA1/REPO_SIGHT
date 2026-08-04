/**
 * backend/lib/auth.ts
 * 
 * Authentication helpers: password hashing, JWT creation/verification,
 * cookie handling, and a simple middleware for protecting routes.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers'; // Vercel provides this in API routes
import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------
// Configuration (should match values in vercel.json environment vars)
// ---------------------------------------------------------------------
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';
const JWT_EXPIRES_IN = '7d'; // tokens valid for 7 days
const COOKIE_NAME = 'cma_token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days in seconds
};

/**
 * Hash a plain‑text password using bcrypt.
 * @param plainTextPassword - The password to hash
 * @returns Promise<string> - The hashed password
 */
export async function hashPassword(plainTextPassword: string): Promise<string> {
  const saltRounds = 12;
  return await bcrypt.hash(plainTextPassword, saltRounds);
}

/**
 * Compare a plain‑text password against a stored hash.
 * @param plainTextPassword - The password provided by the user
 * @param hashedPassword - The hash stored in the database
 * @returns Promise<boolean> - True if they match
 */
export async function comparePassword(
  plainTextPassword: string,
  hashedPassword: string
): Promise<boolean> {
  return await bcrypt.compare(plainTextPassword, hashedPassword);
}

/**
 * Generate a signed JWT for a user.
 * @param userId - The user's database ID (number or string)
 * @param email - The user's email (for payload convenience)
 * @returns string - The signed JWT
 */
export function generateJwt(userId: string | number, email: string): string {
  return jwt.sign({ sub: userId, email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

/**
 * Verify a JWT and return its payload.
 * @param token - The JWT string
 * @returns { userId: string; email: string } | null
 */
export function verifyJwt(token: string): { userId: string; email: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    if (typeof payload.sub === 'string' && typeof payload.email === 'string') {
      return { userId: payload.sub, email: payload.email };
    }
    return null;
  } catch (err) {
    // Invalid or expired token
    return null;
  }
}

/**
 * Set the authentication cookie on a NextResponse.
 * @param res - The response to mutate
 * @param token - The JWT to store in the cookie
 */
export function setAuthCookie(res: NextResponse, token: string): void {
  res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
}

/**
 * Clear the authentication cookie (used on logout).
 * @param res - The response to mutate
 */
export function clearAuthCookie(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, '', {
    ...COOKIE_OPTIONS,
    maxAge: 0, // expire immediately
  });
}

/**
 * Extract the JWT from the request cookies.
 * @param request - The incoming Next.js request (has .cookies property)
 * @returns string | null - The token if present
 */
export function getTokenFromRequest(request: Request): string | null {
  // Vercel's Next.js API routes expose a cookies() helper; we can also read from headers.
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Middleware factory that protects a route handler.
 * Usage:
 *   export const GET = requireAuth(async (request) => {
 *     // handler logic here – you can assume a valid user
 *   });
 *
 * The middleware looks for a valid JWT in the cookies.
 * If missing/invalid, it returns a 401 response.
 * If valid, it calls the original handler and passes the `userId` and `email`
 * as the first two arguments (you can change the signature as you like).
 */
export function requireAuth<
  T extends (...args: any[]) => Promise<NextResponse | Response>
>(handler: T) {
  return async (request: Request): Promise<NextResponse | Response> => {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyJwt(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    // Attach user info to the request so handlers can access it if needed.
    // We'll add a custom property; TypeScript will need a declaration merge if you want strictness.
    // For simplicity, we just pass them as arguments to the handler.
    // The handler signature should accept (request, userId, email) – we'll adapt below.

    // Because we don't know the exact arity of the handler, we'll call it with
    // the original request and let it read the token again if needed.
    // Simpler approach: just allow the handler to proceed; it can call verifyJwt itself.
    // However, to avoid duplicate verification, we attach the payload to request.
    // Since Request is readonly, we clone it via Headers.

    const headers = new Headers(request.headers);
    headers.set('x-user-id', payload.userId);
    headers.set('x-user-email', payload.email);
    const modifiedRequest = new Request(request, { headers });

    return handler(modifiedRequest);
  };
}

/**
 * Helper to extract user ID and email from a request that passed through requireAuth.
 * @param request - The request (must have gone through requireAuth middleware)
 * @returns { userId: string; email: string } | null
 */
export function getUserFromRequest(request: Request): { userId: string; email: string } | null {
  const userId = request.headers.get('x-user-id');
  const email = request.headers.get('x-user-email');
  if (userId && email) return { userId, email };
  return null;
}
