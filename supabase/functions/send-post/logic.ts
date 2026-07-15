// Pure request validation for the send-post service, split out of index.ts for
// unit testing. The Twilio/collage/gallery orchestration stays in index.ts and
// runs on the already-tested _shared modules.

import { sanitizeSong } from '../_shared/song.ts';
import type { PostSong } from '../_shared/song.ts';

export interface SendPostRequest {
  publisherId: string;
  to: string;
  mediaUrls: string[];
  place?: string;
  /** The posting's soundtrack (issue #54); null when absent or malformed. */
  song: PostSong | null;
}

export type SendPostValidation =
  | { ok: true; value: SendPostRequest }
  | { ok: false; error: string };

/**
 * Validates the POST body: requires publisherId, to, and a non-empty array of
 * https media URLs. The song is an enhancement — a malformed one becomes null
 * (never a rejection), so a bad song can't block the send.
 */
export function validateSendPost(
  body: { publisherId?: string; to?: string; mediaUrls?: unknown; place?: string; song?: unknown },
): SendPostValidation {
  const { publisherId, to, mediaUrls, place } = body;
  if (!publisherId || !to || !Array.isArray(mediaUrls) || mediaUrls.length === 0) {
    return { ok: false, error: 'publisherId, to and non-empty mediaUrls are required' };
  }
  if (mediaUrls.some((u) => typeof u !== 'string' || !u.startsWith('https://'))) {
    return { ok: false, error: 'mediaUrls must be https URLs' };
  }
  return {
    ok: true,
    value: { publisherId, to, mediaUrls: mediaUrls as string[], place, song: sanitizeSong(body.song) },
  };
}
