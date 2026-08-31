/**
 * Longest body we are willing to carry in an error message. Enough to read the
 * upstream's own words, short enough that one failure cannot fill a crash
 * report (or a notification) with someone's error page.
 */
const MAX_LENGTH = 200;

/**
 * Turn an upload endpoint's failure body into one readable line.
 *
 * Cloudinary answers a bad request with JSON, but a bad *gateway* answers with
 * whatever sits in front of it — an nginx HTML page. Pasting that into the
 * error message put `Error: Cloudinary upload failed (502): <html>` in Sentry
 * (issue #177): a title that says nothing, and one that groups by whichever
 * markup happened to come back rather than by the failure itself.
 */
export function describeUploadFailure(body: string): string {
  const summary = jsonMessage(body) ?? stripMarkup(body);
  if (summary === '') return 'no response body';
  return summary.length > MAX_LENGTH ? `${summary.slice(0, MAX_LENGTH)}…` : summary;
}

/** Cloudinary's own error shape: `{ error: { message } }`. */
function jsonMessage(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    const message = (parsed as { error?: { message?: unknown } } | null)?.error?.message;
    return typeof message === 'string' && message.trim() !== '' ? message.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Keep the words, drop the markup. `<script>`/`<style>` go with their contents:
 * their bodies are code, and a stray stylesheet reads as gibberish.
 */
function stripMarkup(body: string): string {
  return body
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
