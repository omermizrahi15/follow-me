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
  const replyLink = `https://wa.me/${phone.replace(/^\+/, '')}`;
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
