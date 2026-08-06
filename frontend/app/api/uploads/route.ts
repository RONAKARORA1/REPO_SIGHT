/* frontend/app/api/uploads/route.ts */
import { NextResponse } from 'next/server';
import { uploadBlob } from '@/lib/storage';
import { v4 as uuidv4 } from 'uuid';

export const POST = async (req: Request) => {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return new Response('No file', { status: 400 });

  const uniqueName = `${uuidv4()}-${file.name.replace(/\s+/g, '_')}`;
  const blob = await uploadBlob(uniqueName, file.stream(), {
    contentType: file.type,
    access: 'private',
  });

  return NextResponse.json({ uploadId: blob.pathname, url: blob.url });
};
