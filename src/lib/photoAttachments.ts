import type { SupabaseClient } from '@supabase/supabase-js';
import { compressImage } from './compressImage';

type PhotoFolder = 'waste' | 'receipts';

export async function attachPrivatePhotos(db: SupabaseClient, folder: PhotoFolder, parentId: string, files: File[]) {
  const uploadedPaths: string[] = [];
  try {
    for (const file of files) {
      const prepared = await compressImage(file);
      const path = `${folder}/${parentId}/${crypto.randomUUID()}.jpg`;
      const { error } = await db.storage.from('operational-photos').upload(path, prepared, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
      uploadedPaths.push(path);
    }

    const metadataResult = folder === 'waste'
      ? await db.from('waste_record_photos').insert(uploadedPaths.map((file_path) => ({ waste_record_id: parentId, file_path })) as never)
      : await db.from('expense_receipt_photos').insert(uploadedPaths.map((file_path) => ({ expense_id: parentId, file_path })) as never);
    if (metadataResult.error) throw metadataResult.error;
  } catch (error) {
    if (uploadedPaths.length) await db.storage.from('operational-photos').remove(uploadedPaths);
    throw error;
  }
}

export async function signPrivatePhotos(db: SupabaseClient, paths: string[]) {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (!uniquePaths.length) return {};
  // One request for all photos instead of one request per photo.
  const { data } = await db.storage.from('operational-photos').createSignedUrls(uniquePaths, 300);
  const signed: Record<string, string> = Object.fromEntries(uniquePaths.map((path) => [path, '']));
  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) signed[item.path] = item.signedUrl;
  }
  return signed;
}
