// Pure helpers for delete-candidates, split out of index.ts for unit testing:
// Cloudinary public-id parsing and signed-destroy signature building.

/** Extracts the Cloudinary public id (folder path + name, no extension) from a delivery URL. */
export function publicIdFromUrl(url: string): string | null {
  const m = url.match(/\/image\/upload\/(?:[^/]+\/)*?v\d+\/(.+?)(\.[A-Za-z0-9]+)?$/);
  return m?.[1] ?? null;
}

export async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cloudinary signed-destroy signature: SHA-1 of the sorted params joined with the API secret. */
export function cloudinaryDestroySignature(publicId: string, timestamp: number, apiSecret: string): Promise<string> {
  return sha1Hex(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`);
}
