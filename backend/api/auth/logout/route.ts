/**
 * POST /api/auth/logout
 * 
 * Clears the authentication cookie.
 * 
 * On success:
 *   - Returns a simple JSON message
 *   - Status 200
 */

import { NextResponse } from 'next/server';
import { clearAuthCookie } from '../../lib/auth';

export const POST = async (): Promise<NextResponse> => {
  const res = NextResponse.json({ message: 'Logged out' }, { status: 200 });
  clearAuthCookie(res);
  return res;
};
