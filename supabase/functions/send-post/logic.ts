// Pure request validation for the send-post service, split out of index.ts for
// unit testing. The Twilio/collage/gallery orchestration stays in index.ts and
// runs on the already-tested _shared modules.

import { normalizeCaption } from '../../../src/domain/services/caption.ts';

export interface SendPostRequest {
  publisherId: string;
  to: string;
  mediaUrls: string[];
  place?: string;
  /**
   * The batch id the app stamped on this posting's `media` rows. Optional: it
   * only reached the body with the delete fix, and a build that predates it
   * still sends fine — its gallery row just carries no posting id, so it can't
   * be trashed with the post.
   */
  postingId?: string;
  /**
   * The publisher's optional words about the post (issue #220). Already
   * normalised: absent means "no caption", never an empty string.
   */
  caption?: string;
}

export type SendPostValidation =
  | { ok: true; value: SendPostRequest }
  | { ok: false; error: string };

/** Validates the POST body: requires publisherId, to, and a non-empty array of https media URLs. */
export function validateSendPost(
  body: {
    publisherId?: string;
    to?: string;
    mediaUrls?: unknown;
    place?: string;
    postingId?: string;
    caption?: unknown;
  },
): SendPostValidation {
  const { publisherId, to, mediaUrls, place, postingId } = body;
  if (!publisherId || !to || !Array.isArray(mediaUrls) || mediaUrls.length === 0) {
    return { ok: false, error: 'publisherId, to and non-empty mediaUrls are required' };
  }
  if (mediaUrls.some((u) => typeof u !== 'string' || !u.startsWith('https://'))) {
    return { ok: false, error: 'mediaUrls must be https URLs' };
  }
  // The body is untrusted, so the app's trimming and cap are applied again here.
  const caption = normalizeCaption(body.caption);
  return {
    ok: true,
    value: {
      publisherId,
      to,
      mediaUrls: mediaUrls as string[],
      place,
      postingId,
      ...(caption != null ? { caption } : {}),
    },
  };
}
