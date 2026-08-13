import type { ITwilioClient } from './WhatsAppNotifier';
import { sendWhatsApp, type SendOptions } from './twilioClient';

// The send itself — retries, back-off and permanent/transient classification —
// lives in ./twilioClient, which the Deno Edge Functions import directly. This
// adapter exists only to present it as the app's ITwilioClient port.
export { TwilioSendError } from './twilioClient';

export class TwilioClientAdapter implements ITwilioClient {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
    private readonly options: SendOptions = {},
  ) {}

  /**
   * Transient failures (429 Too Many Requests, 5xx, network errors) are
   * retried with exponential back-off up to maxRetries (default 3). Permanent
   * failures throw immediately with `permanent: true` so callers can mark the
   * subscriber unreachable instead of retrying.
   */
  async sendWhatsApp(to: string, body: string, mediaUrl?: string): Promise<void> {
    await sendWhatsApp(
      { accountSid: this.accountSid, authToken: this.authToken, fromNumber: this.fromNumber },
      to,
      body,
      mediaUrl,
      this.options,
    );
  }
}
