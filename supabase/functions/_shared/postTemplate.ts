// Maps a post to an approved WhatsApp template send (issue #24).
//
// Business-initiated posts land outside WhatsApp's 24h session window, so they
// must go out as an approved template rather than free-form text. This picks
// the right ContentSid and fills its {{n}} variables. The variable ORDER here
// must stay in lock-step with the templates registered in Twilio:
//
//   follow_me_post_location (has place):
//     1 name · 2 place · 3 count · 4 galleryUrl · 5 name · 6 replyLink · 7 media
//   follow_me_post (no place):
//     1 name · 2 count · 3 galleryUrl · 4 name · 5 replyLink · 6 media
//
// No imports on purpose — keeps this file jest-importable from src/ tests.

export interface PostTemplateEnv {
  /** ContentSid of the no-location template. */
  postSid?: string;
  /** ContentSid of the with-location template. */
  postLocationSid?: string;
}

export interface PostTemplateInput {
  publisherName: string;
  publisherPhone?: string;
  place?: string | null;
  photoCount: number;
  galleryUrl?: string | null;
  /** The single header image (collage) the template attaches. */
  mediaUrl?: string | null;
}

export interface TemplateSend {
  contentSid: string;
  variables: Record<string, string>;
}

/** WhatsApp rejects variable values with newlines/tabs or >4 spaces; collapse them. */
function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The follower's reply link, pre-filled with which post it answers (issue #143).
 *
 * MIRROR of `composeReplyLink` in `src/domain/services/notificationBody.ts` —
 * see the rationale there. It is duplicated rather than imported because this
 * file must stay import-free (header), and `postTemplate.test.ts` asserts the
 * two stay byte-identical.
 *
 * The whole URL is a template *variable* value, not part of the approved body
 * text, so widening it needs no re-approval in Twilio. Spaces arrive
 * percent-encoded, which also satisfies WhatsApp's "no runs of whitespace in a
 * variable" rule for free.
 */
function replyLinkFor(phone: string, place?: string | null): string {
  const waPhone = phone.replace(/^\+/, '');
  const label = clean(place ?? '');
  const subject = label !== '' ? `your photos from ${label}` : 'your latest photos';
  return `https://wa.me/${waPhone}?text=${encodeURIComponent(`Re: ${subject} ✨`)}`;
}

/**
 * Returns the template send for a post, or null when a template can't be used
 * (SIDs not configured, or the post lacks the gallery link / publisher phone /
 * header image the template requires) — the caller then falls back to free-form.
 */
export function buildPostTemplate(env: PostTemplateEnv, input: PostTemplateInput): TemplateSend | null {
  const gallery = input.galleryUrl;
  const media = input.mediaUrl;
  const phone = input.publisherPhone;
  if (!gallery || !media || !phone) return null;

  const name = clean(input.publisherName);
  // Fed the raw place even on the no-location branch: that branch only drops
  // the "from {place}" clause from the *body*, and naming the place in the
  // reply subject is still accurate — and more useful there, not less.
  const replyLink = replyLinkFor(phone, input.place);
  const count = String(input.photoCount);
  const hasPlace = input.place != null && input.place.trim() !== '';

  if (hasPlace && env.postLocationSid) {
    return {
      contentSid: env.postLocationSid,
      variables: {
        '1': name,
        '2': clean(input.place as string),
        '3': count,
        '4': gallery,
        '5': name,
        '6': replyLink,
        '7': media,
      },
    };
  }

  // No place, or the location template isn't configured — the no-location
  // template drops the "from {place}" clause and is otherwise identical.
  if (env.postSid) {
    return {
      contentSid: env.postSid,
      variables: {
        '1': name,
        '2': count,
        '3': gallery,
        '4': name,
        '5': replyLink,
        '6': media,
      },
    };
  }

  return null;
}
