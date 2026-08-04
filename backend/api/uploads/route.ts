/**
 * POST /api/uploads
 * 
 * Handles file uploads (expects a multipart/form-data with a file field named 'file').
 * 
 * On success:
 *   - Stores the uploaded file in Vercel Blob Storage (private access)
 *   - Returns the blob ID (uploadId) and a signed URL for temporary download (if needed)
 *   - Status 200
 * 
 * On error:
 *   - 400 if no file provided or file type invalid
 *   - 413 if file too large
 *   - 500 for unexpected errors
 */

import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { uploadBlob } from '../lib/storage';

// Configuration
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  // Optionally allow other archive types if you wish
];

export const POST = async (request: Request): Promise<NextResponse> => {
  try {
    // Verify content type is multipart/form-data
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.startsWith('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Expected multipart/form-data' },
        { status: 400 }
      );
    }

    // Parse the form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_UPLOAD_SIZE / 1024 / 1024} MB)` },
        { status: 413 }
      );
    }

    // Validate MIME type (optional but recommended)
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Only ZIP files are allowed' },
        { status: 400 }
      );
    }

    // Generate a unique blob name (UUID prefix + original filename)
    const uniqueName = `${uuidv4()}-${file.name.replace(/\s+/g, '_')}`;

    // Upload to Vercel Blob Storage (private access)
    const blob = await uploadBlob(uniqueName, file.stream(), {
      contentType: file.type,
      access: 'private',
    });

    // Return the blob ID and a URL (the URL is signed and expires shortly)
    return NextResponse.json(
      {
        uploadId: blob.pathname, // this is the unique name we used
        url: blob.url,           // signed URL for direct download (if needed)
        originalName: file.name,
        size: file.size,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('Upload error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
};
