// Pure request validation for the send-post service, split out of index.ts for
// unit testing. The Twilio/collage/gallery orchestration stays in index.ts and
// runs on the already-tested _shared modules.

export interface SendPostRequest {
  publisherId: string;
  to: string;
  mediaUrls: string[];
  place?: string;
}

export type SendPostValidation =
  | { ok: true; value: SendPostRequest }
  | { ok: false; error: string };

/** Validates the POST body: requires publisherId, to, and a non-empty array of https media URLs. */
export function validateSendPost(
  body: { publisherId?: string; to?: string; mediaUrls?: unknown; place?: string },
): SendPostValidation {
  const { publisherId, to, mediaUrls, place } = body;
  if (!publisherId || !to || !Array.isArray(mediaUrls) || mediaUrls.length === 0) {
    return { ok: false, error: 'publisherId, to and non-empty mediaUrls are required' };
  }
  if (mediaUrls.some((u) => typeof u !== 'string' || !u.startsWith('https://'))) {
    return { ok: false, error: 'mediaUrls must be https URLs' };
  }
  return { ok: true, value: { publisherId, to, mediaUrls: mediaUrls as string[], place } };
}
