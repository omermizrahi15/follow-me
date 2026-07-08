import type { ITwilioClient } from './WhatsAppNotifier';

/**
 * A Twilio send that failed after classification (issue #24). `permanent`
 * failures (4xx other than 429: invalid number, opted-out recipient, auth)
 * must NOT be retried; transient ones (429 / 5xx / network) already were.
 *
 * Mirrored in supabase/functions/_shared/twilio.ts (the Deno port used by the
 * edge functions) — keep the classification in sync.
 */
export class TwilioSendError extends Error {
  constructor(
    message: string,
    readonly status: number | null, // null = network error, no HTTP response
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'TwilioSendError';
  }
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export class TwilioClientAdapter implements ITwilioClient {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
    private readonly options: {
      /** Retries after the first attempt, for transient failures only. */
      maxRetries?: number;
      /** Base backoff delay; retry n waits base * 2^(n-1). Exposed for tests. */
      baseDelayMs?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {}

  /**
   * Transient failures (429 Too Many Requests, 5xx, network errors) are
   * retried with exponential back-off up to maxRetries (default 3). Permanent
   * failures throw immediately with `permanent: true` so callers can mark the
   * subscriber unreachable instead of retrying.
   */
  async sendWhatsApp(to: string, body: string, mediaUrl?: string): Promise<void> {
    const { maxRetries = 3, baseDelayMs = 500, sleep = defaultSleep } = this.options;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

    const params = new URLSearchParams({
      To: `whatsapp:${to}`,
      From: `whatsapp:${this.fromNumber}`,
      Body: body,
    });
    if (mediaUrl != null) params.append('MediaUrl', mediaUrl);

    let lastError: TwilioSendError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleep(baseDelayMs * 2 ** (attempt - 1));

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });
      } catch (err) {
        // No HTTP response at all — network blip, always worth retrying.
        lastError = new TwilioSendError(
          `Twilio request failed: ${err instanceof Error ? err.message : String(err)}`,
          null,
          false,
        );
        continue;
      }

      if (response.ok) return;

      const text = await response.text();
      const permanent = !isTransientStatus(response.status);
      lastError = new TwilioSendError(`Twilio error (${response.status}): ${text}`, response.status, permanent);
      if (permanent) throw lastError;
    }

    throw lastError ?? new TwilioSendError('Twilio send failed', null, false);
  }
}
