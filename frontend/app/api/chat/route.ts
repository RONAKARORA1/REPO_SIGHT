// frontend/app/api/chat/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// -------------------------------------------------------------------
// Helper: make sure the request is from an authenticated user
// -------------------------------------------------------------------
function getAuthUser(req: NextRequest): { id: string } | null {
  // Adjust this if your auth middleware stores the user under a different key.
  // Example with NextAuth: req.headers.get('cookie') is parsed elsewhere,
  // and you would call `getServerSession` – but for simplicity we assume
  // a middleware already placed `req.user`.
  const user = (req as any).user;
  if (user && typeof user.id === 'string') return { id: user.id };
  return null;
}

// -------------------------------------------------------------------
// POST /api/chat – create a new chat (or send a message, adapt as needed)
// -------------------------------------------------------------------
export async function POST(req: NextRequest) {
  // 1������ Get the authenticated user
  const authUser = getAuthUser(req);
  if (!authUser) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // 2������ Extract the userId the client wants to work with
  // (you can also get it from URL params or query string – adjust as needed)
  let userId: string | undefined;
  try {
    const body = await req.json();
    userId = body.userId;
  } catch {
    // If JSON parsing fails, treat as missing
    userId = undefined;
  }

  if (!userId || typeof userId !== 'string') {
    return NextResponse.json(
      { error: 'Missing or invalid userId in request body' },
      { status: 400 }
    );
  }

  // 3������ **Authorization check – must be the very first thing**
  if (userId !== authUser.id) {
    return NextResponse.json(
      { error: 'Unauthorized: you can only act on your own account' },
      { status: 401 }
    );
  }

  // 4������ �� Safe to proceed – we now know `userId` belongs to the logged‑in user
  // -------------------------------------------------------------------
  // Example: create a chat record in your database (Prisma, Vercel Postgres, etc.)
  // -------------------------------------------------------------------
  // If you use Vercel Postgres via the @vercel/postgres helper:
  // import { sql } from '@/lib/db';
  // const { rows } = await sql`
  //   INSERT INTO chats (user_id, title, created_at)
  //   VALUES (${authUser.id}, 'New Chat', NOW())
  //   RETURNING id, user_id, title, created_at;
  // `;
  // const chat = rows[0];

  // For illustration we’ll just return a mock object.
  const chat = {
    id: crypto.randomUUID(),
    userId: authUser.id,
    title: 'New Chat',
    createdAt: new Date().toISOString(),
  };

  return NextResponse.json(chat, { status: 201 });
}

// -------------------------------------------------------------------
// OPTIONAL: GET /api/chat – list chats for the logged‑in user
// -------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Example: fetch chats for this user from the DB
  // const { rows } = await sql`
  //   SELECT id, title, created_at FROM chats
  //   WHERE user_id = ${authUser.id}
  //   ORDER BY created_at DESC;
  // `;
  // return NextResponse.json(rows, { status: 200 });

  // Mock response for now:
  return NextResponse.json(
    [
      { id: '1', userId: authUser.id, title: 'Sample Chat', createdAt: new Date().toISOString() }
    ],
    { status: 200 }
  );
}

// -------------------------------------------------------------------
// OPTIONAL: DELETE /api/chat/[chatId] – delete a specific chat
// -------------------------------------------------------------------
export async function DELETE(
  req: NextRequest,
  { params }: { params: { chatId: string } }
) {
  const authUser = getAuthUser(req);
  if (!authUser) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Verify ownership before deleting
  // const { rows } = await sql`
  //   SELECT user_id FROM chats WHERE id = ${params.chatId}
  // `;
  // if (rows.length === 0) {
  //   return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  // }
  // if (rows[0].user_id !== authUser.id) {
  //   return NextResponse.json(
  //     { error: 'Unauthorized: you can only delete your own chats' },
  //     { status: 401 }
  //   );
  // }
  // await sql`DELETE FROM chats WHERE id = ${params.chatId}`;

  return NextResponse.json(
    { message: 'Chat deleted' },
    { status: 200 }
  );
}
