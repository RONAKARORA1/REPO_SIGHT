/**
 * backend/lib/storage.ts
 * 
 * Helper functions for interacting with Vercel Blob Storage and Vercel Postgres.
 * All functions are async and return promises.
 */

import { BlobClient, list, put, get, del } from '@vercel/blob';
import { sql } from '@vercel/postgres';
import { v4 as uuidv4 } from 'uuid';

/**
 * Upload a file (or stream) to Vercel Blob Storage.
 * @param fileName - The name to store the blob as (will be made unique with a UUID prefix)
 * @param data - Either a Buffer, string, or Node.js readable stream
 * @param options - Optional blob options (contentType, access, etc.)
 * @returns {Promise<{ url: string; uploadId: string }>} The public URL and the upload ID (used for deletion)
 */
export async function uploadBlob(
  fileName: string,
  data: BlobPart | ReadableStream<Uint8Array>,
  options: { contentType?: string; access?: 'public' | 'private' } = {}
): Promise<{ url: string; uploadId: string }> {
  const uniqueName = `${uuidv4()}-${fileName}`;
  const blob = await put(uniqueName, data, {
    access: options.access ?? 'private',
    contentType: options.contentType,
    // Add a token if you need to restrict access; otherwise Vercel handles it
  });
  return { url: blob.url, uploadId: uniqueName };
}

/**
 * Retrieve a blob from Vercel Blob Storage as a Buffer.
 * @param uploadId - The name returned from `uploadBlob` (the UUID‑prefixed key)
 * @returns {Promise<Buffer>} The blob contents as a Node.js Buffer
 */
export async function fetchBlob(uploadId: string): Promise<Buffer> {
  const { blob } = await get(uploadId);
  if (!blob) throw new Error(`Blob not found: ${uploadId}`);
  // The blob object from @vercel/blob has an `arrayStream()` method; we'll collect it.
  const chunks: Uint8Array[] = [];
  for await (const chunk of blob.streaming()) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Delete a blob from Vercel Blob Storage.
 * @param uploadId - The name returned from `uploadBlob`
 */
export async function deleteBlob(uploadId: string): Promise<void> {
  await del(uploadId);
}

/**
 * List all blobs with a given prefix (useful for cleaning up temporary uploads).
 * @param prefix - Prefix to filter blobs (e.g., a user ID or session ID)
 * @returns {Promise<string[]>} Array of blob names matching the prefix
 */
export async function listBlobsWithPrefix(prefix: string): Promise<string[]>): Promise<string[]> {
    const { blobs } = await list({ prefix });
    return blobs.map(b => b.pathname);
}

/**
 * Execute a raw SQL query safely via Vercel Postgres.
 * @param query - SQL query string with optional $1, $2, … placeholders
 * @param values - Values to inject into the query (protected against SQL injection)
 * @returns {Promise<any>} The query result (rows array for SELECT, command tag for others)
 */
export async function query(
  query: string,
  values: (string | number | boolean | null)[] = []
) {
  try {
    const result = await sql.query(query, values);
    return result;
  } catch (err) {
    console.error('Database query error:', err);
    throw err;
  }
}

/**
 * Helper to run a query and return a single row (or null).
 */
export async function queryOne(
  query: string,
  values: (string | number | boolean | null)[] = []
) {
  const res = await query(query, values);
  return res.rows[0] ?? null;
}

/**
 * Helper to run a query and return a single value from the first column of the first row.
 */
export async function queryValue<
  T = string | number | boolean | null
>(
  query: string,
  values: (string | number | boolean | null)[] = []
): Promise<T | null> {
  const row = await queryOne(query, values);
  if (!row) return null;
  // Assuming the first column is the value we want
  const firstVal = Object.values(row)[0];
  return firstVal as T | null;
}
