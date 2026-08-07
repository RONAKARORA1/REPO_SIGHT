// frontend/lib/storage.ts
import { supabase } from './db';

export async function uploadBlob(path: string, data: Buffer | Blob, contentType?: string) {
  const { error } = await supabase.storage.from('scans').upload(path, data, { contentType, upsert: true });
  if (error) throw error;
  return supabase.storage.from('scans').getPublicUrl(path).data;
}

export async function fetchBlob(path: string) {
  const { data, error } = await supabase.storage.from('scans').download(path);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}
