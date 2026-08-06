// frontend/app/api/auth.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyJwt } from '@/lib/auth'; // you already have this from earlier files

export async function middleware(req: NextRequest) {
  const token = req.cookies.get('cma_token')?.value ?? '';
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  // Attach the user to the request so handlers can read `req.user`
  (req as any).user = { id: payload.userId };
  // Continue to the actual handler
  return NextResponse.next();
}
