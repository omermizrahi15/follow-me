import { cloudinaryDestroySignature } from '../delete-candidates/logic.ts';

export interface CloudinaryCreds {
  cloud: string;
  key: string;
  secret: string;
}

export function cloudinaryCredsFromEnv(env: { get(k: string): string | undefined }): CloudinaryCreds | null {
  const cloud = env.get('CLOUDINARY_CLOUD_NAME') ?? '';
  const key = env.get('CLOUDINARY_API_KEY') ?? '';
  const secret = env.get('CLOUDINARY_API_SECRET') ?? '';
  return cloud !== '' && key !== '' && secret !== '' ? { cloud, key, secret } : null;
}

/** Signed Cloudinary destroy — returns true when the asset was deleted (or already gone). */
export async function destroyCloudinaryAsset(creds: CloudinaryCreds, publicId: string): Promise<boolean> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await cloudinaryDestroySignature(publicId, timestamp, creds.secret);
  const form = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: creds.key,
    signature,
  });
  const res = await fetch(`https://api.cloudinary.com/v1_1/${creds.cloud}/image/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { result?: string };
  return data.result === 'ok' || data.result === 'not found';
}
