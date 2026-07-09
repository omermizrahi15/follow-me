// Deno port of src/infrastructure/notifiers/TwilioClientAdapter.ts.
// Plain fetch + btoa, both available in Deno (and in Node 18+, so jest tests
// can import this file directly — see twilioSend.test.ts).

export interface TwilioCreds {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  /**
   * Prefer a Twilio API key over the account auth token (issue #24): the key
   * can be rotated/revoked without touching the account secret. When both are
   * set they are used for Basic auth instead of accountSid:authToken.
   */
  apiKeySid?: string;
  apiKeySecret?: string;
  /**
   * Public URL Twilio POSTs delivery-status updates to (the `twilio-status`
   * edge function). Sent as StatusCallback on every message when set.
   */
  statusCallback?: string;
  /**
   * Approved WhatsApp template ContentSids for post notifications (issue #24).
   * When set, posts send via the template (works out-of-session); when unset,
   * callers fall back to a free-form send (sandbox / pre-approval). The
   * `*Location` variant carries the "from {place}" clause.
   */
  templatePostSid?: string;
  templatePostLocationSid?: string;
}

/**
 * A Twilio send that failed after classification. `permanent` failures (4xx
 * other than 429: bad number, blocked sender, auth) must NOT be retried;
 * transient ones (429 / 5xx / network) already were, up to `maxRetries`.
 */
export class TwilioSendError extends Error {
  constructor(
    message: string,
    readonly status: number | null, // null = network error, no HTTP response
    readonly twilioCode: number | null,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'TwilioSendError';
  }
}

export function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface SendOptions {
  /** Retries after the first attempt, for transient failures only. */
  maxRetries?: number;
  /** Base backoff delay; attempt n waits base * 2^n. Exposed for tests. */
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}

export interface SendResult {
  /** Twilio message SID (SM… / MM…) — key for delivery-status tracking. */
  sid: string | null;
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function authHeader(creds: TwilioCreds): string {
  const pair = creds.apiKeySid && creds.apiKeySecret
    ? `${creds.apiKeySid}:${creds.apiKeySecret}`
    : `${creds.accountSid}:${creds.authToken}`;
  return `Basic ${btoa(pair)}`;
}

/**
 * POSTs an already-built Messages payload with retry/classification. Transient
 * failures (429 Too Many Requests, 5xx, network errors) are retried with
 * exponential back-off up to `maxRetries` (default 3); permanent failures
 * (other 4xx — invalid number, opted-out recipient, auth) throw a
 * `TwilioSendError` with `permanent: true` immediately so callers can mark the
 * subscriber unreachable instead of retrying.
 */
async function sendMessage(
  creds: TwilioCreds,
  params: URLSearchParams,
  options: SendOptions,
): Promise<SendResult> {
  const { maxRetries = 3, baseDelayMs = 500, sleep = defaultSleep, fetchImpl = fetch } = options;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;
  if (creds.statusCallback) params.append('StatusCallback', creds.statusCallback);

  let lastError: TwilioSendError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(baseDelayMs * 2 ** (attempt - 1));

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader(creds),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
    } catch (err) {
      // No HTTP response at all — network blip, always worth retrying.
      lastError = new TwilioSendError(
        `Twilio request failed: ${err instanceof Error ? err.message : String(err)}`,
        null,
        null,
        false,
      );
      continue;
    }

    if (res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { sid?: string };
      return { sid: payload.sid ?? null };
    }

    const text = await res.text();
    // Twilio error bodies are JSON with a numeric `code` (e.g. 21211).
    let twilioCode: number | null = null;
    try {
      const parsed = JSON.parse(text) as { code?: number };
      if (typeof parsed.code === 'number') twilioCode = parsed.code;
    } catch { /* non-JSON body — keep code null */ }

    const permanent = !isTransientStatus(res.status);
    lastError = new TwilioSendError(`Twilio error (${res.status}): ${text}`, res.status, twilioCode, permanent);
    if (permanent) throw lastError;
  }

  // Retries exhausted on a transient failure.
  throw lastError ?? new TwilioSendError('Twilio send failed', null, null, false);
}

/**
 * Sends one free-form WhatsApp message (Body + optional MediaUrl). Only
 * deliverable inside the 24h customer-service window (or in the sandbox); for
 * business-initiated messages outside that window use `sendWhatsAppTemplate`.
 */
export function sendWhatsApp(
  creds: TwilioCreds,
  to: string,
  body: string,
  mediaUrl?: string,
  options: SendOptions = {},
): Promise<SendResult> {
  const params = new URLSearchParams({
    To: `whatsapp:${to}`,
    From: `whatsapp:${creds.fromNumber}`,
    Body: body,
  });
  if (mediaUrl != null) params.append('MediaUrl', mediaUrl);
  return sendMessage(creds, params, options);
}

/**
 * Sends an approved WhatsApp template message (Content API `ContentSid` +
 * `ContentVariables`). Works both in and out of the 24h session window, so this
 * is the production path for business-initiated posts. `variables` maps the
 * template's {{n}} placeholders (including any media-header variable) to values.
 */
export function sendWhatsAppTemplate(
  creds: TwilioCreds,
  to: string,
  contentSid: string,
  variables: Record<string, string>,
  options: SendOptions = {},
): Promise<SendResult> {
  const params = new URLSearchParams({
    To: `whatsapp:${to}`,
    From: `whatsapp:${creds.fromNumber}`,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(variables),
  });
  return sendMessage(creds, params, options);
}

export interface BatchSendResult {
  sent: number;
  failed: number;
  errors: string[];
  /** SIDs of the messages that were accepted, in send order. */
  sids: string[];
  /**
   * Set when a send failed permanently (invalid/blocked number). The remaining
   * items were skipped — they would fail the same way — so the caller can mark
   * the subscriber unreachable.
   */
  permanentError: TwilioSendError | null;
}

/**
 * Rewrites a Cloudinary delivery URL so the media is WhatsApp-compatible:
 * JPEG (iPhones upload HEIC, which WhatsApp rejects with error 63021), bounded
 * width and auto quality (WhatsApp caps images at 5MB). Non-Cloudinary URLs
 * pass through unchanged.
 */
export function whatsappSafeMediaUrl(url: string): string {
  if (!url.includes('/image/upload/') || url.includes('/image/upload/f_')) return url;
  return url.replace('/image/upload/', '/image/upload/f_jpg,q_auto:good,w_1600/');
}

/**
 * Sends a batch of photo URLs to one subscriber. Twilio WhatsApp allows one
 * MediaUrl per message: the first carries the caption, the rest carry only media.
 *
 * Messages are paced (default ~1.1s apart) because Twilio throttles WhatsApp
 * to ~1 msg/sec — rapid-fire batches silently drop messages. A transient
 * failure is recorded and the batch continues, so one flaky send doesn't lose
 * the rest; a PERMANENT failure (bad number, opted out) aborts the remainder —
 * every following message to the same number would fail identically.
 */
export async function sendBatch(
  creds: TwilioCreds,
  to: string,
  caption: string,
  mediaUrls: string[],
  pauseMs = 1100,
): Promise<BatchSendResult> {
  let sent = 0;
  const errors: string[] = [];
  const sids: string[] = [];
  let permanentError: TwilioSendError | null = null;

  for (let i = 0; i < mediaUrls.length; i++) {
    try {
      const { sid } = await sendWhatsApp(
        creds,
        to,
        i === 0 ? caption : '',
        whatsappSafeMediaUrl(mediaUrls[i] ?? ''),
      );
      sent++;
      if (sid != null) sids.push(sid);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      if (err instanceof TwilioSendError && err.permanent) {
        permanentError = err;
        break;
      }
    }
    if (i < mediaUrls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, pauseMs));
    }
  }
  return { sent, failed: errors.length, errors, sids, permanentError };
}

/** Builds TwilioCreds from the standard edge-function environment variables. */
export function credsFromEnv(env: { get(key: string): string | undefined }): TwilioCreds {
  const creds: TwilioCreds = {
    accountSid: env.get('TWILIO_ACCOUNT_SID') ?? '',
    authToken: env.get('TWILIO_AUTH_TOKEN') ?? '',
    fromNumber: env.get('TWILIO_WHATSAPP_FROM') ?? '',
  };
  const apiKeySid = env.get('TWILIO_API_KEY_SID');
  const apiKeySecret = env.get('TWILIO_API_KEY_SECRET');
  const statusCallback = env.get('TWILIO_STATUS_CALLBACK_URL');
  const templatePostSid = env.get('TWILIO_TEMPLATE_POST_SID');
  const templatePostLocationSid = env.get('TWILIO_TEMPLATE_POST_LOCATION_SID');
  if (apiKeySid) creds.apiKeySid = apiKeySid;
  if (apiKeySecret) creds.apiKeySecret = apiKeySecret;
  if (statusCallback) creds.statusCallback = statusCallback;
  if (templatePostSid) creds.templatePostSid = templatePostSid;
  if (templatePostLocationSid) creds.templatePostLocationSid = templatePostLocationSid;
  return creds;
}
