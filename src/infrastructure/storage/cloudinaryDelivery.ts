/**
 * URL helpers for Cloudinary-hosted media delivery. Pure string transforms —
 * safe to call with any URL; non-Cloudinary URLs pass through untouched.
 */

const UPLOAD_SEGMENT = '/upload/';

function isCloudinary(uri: string): boolean {
  return uri.includes('res.cloudinary.com') && uri.includes(UPLOAD_SEGMENT);
}

/**
 * Right-size a Cloudinary delivery URL for on-screen display instead of
 * shipping the original upload (a phone camera photo is several MB; the feed
 * needs ~a tenth of that). `c_limit` never upscales; f_auto/q_auto let
 * Cloudinary pick the best format and compression per device.
 */
export function displaySizedUri(uri: string, width: number): string {
  if (!isCloudinary(uri)) return uri;
  const insert = uri.indexOf(UPLOAD_SEGMENT) + UPLOAD_SEGMENT.length;
  return `${uri.slice(0, insert)}w_${width},c_limit,f_auto,q_auto/${uri.slice(insert)}`;
}
