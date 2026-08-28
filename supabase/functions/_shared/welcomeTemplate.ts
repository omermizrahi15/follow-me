// Maps the new-follower welcome to an approved WhatsApp template (issue #164).
//
// The join page collects a number the follower typed — they never message our
// sender — so the welcome is business-initiated with no 24h session window
// open. On a production sender that means it must go out as an approved
// template or Twilio rejects it with 63016. The variable ORDER here must stay
// in lock-step with the template registered in Twilio:
//
//   follow_me_subscriber_welcome_2:
//     1 name · 2 galleryUrl
//
// {{2}} is the publisher's feed (every post so far), added so the welcome is
// worth something before the first new post arrives. It is a *variable* rather
// than body text both because it differs per publisher and because URL changes
// inside a variable never need re-approval — same rule the post templates
// follow for the reply link.
//
// No imports on purpose — keeps this file jest-importable from src/ tests.

export interface WelcomeTemplateEnv {
  /** ContentSid of the welcome template. */
  welcomeSid?: string;
}

export interface WelcomeTemplateInput {
  publisherName: string;
  /** The publisher's feed page — `publisherGalleryUrl(publisherId)`. */
  galleryUrl: string;
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
 * Returns the template send for the welcome, or null when the SID isn't
 * configured (sandbox / before approval) — the caller then falls back to a
 * free-form send, which works there because the sandbox opt-in opens a window.
 */
export function buildWelcomeTemplate(
  env: WelcomeTemplateEnv,
  input: WelcomeTemplateInput,
): TemplateSend | null {
  if (!env.welcomeSid) return null;

  const name = clean(input.publisherName);
  const gallery = clean(input.galleryUrl ?? '');
  // A template with an empty slot reads as broken; free-form says the same
  // words and is at least whole, so hand the caller its fallback instead.
  if (name === '' || gallery === '') return null;

  return { contentSid: env.welcomeSid, variables: { '1': name, '2': gallery } };
}
