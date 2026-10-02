/**
 * The publisher's optional caption on a post (issue #220).
 *
 * DUAL RUNTIME — the app trims what the publisher typed before sending it, and
 * the `send-post` Edge Function runs the same rules again on whatever arrives
 * (the body is untrusted). Import-free and platform-free; see CONTRIBUTING.md.
 */

/**
 * Longest caption kept. A WhatsApp template variable tops out well above this,
 * but a caption is a sentence under the photos, not a message of its own — and
 * a cap here is what keeps the gallery card and the chat bubble readable.
 */
export const MAX_CAPTION_LENGTH = 280;

/**
 * The caption as it should be stored and sent, or null when there is none.
 *
 * Line breaks the publisher typed survive (the gallery and free-form messages
 * can show them), but runs of blank lines collapse so a caption can't push the
 * link out of sight. Anything past the cap is cut without splitting an emoji.
 */
export function normalizeCaption(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text === '') return null;
  if (text.length <= MAX_CAPTION_LENGTH) return text;

  let end = MAX_CAPTION_LENGTH;
  // Cutting between the halves of a surrogate pair leaves an invalid string.
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end).trimEnd();
}

/**
 * WhatsApp rejects template variables containing newlines, tabs or runs of
 * more than four spaces, so a caption bound for a template
 * is flattened to single spaces. Free-form sends keep `normalizeCaption`'s line
 * breaks instead.
 */
export function captionForTemplate(caption: string): string {
  return caption.replace(/\s+/g, ' ').trim();
}
