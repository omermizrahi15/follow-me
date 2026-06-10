import type { ITwilioClient } from './WhatsAppNotifier';

export class TwilioClientAdapter implements ITwilioClient {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
  ) {}

  async sendWhatsApp(to: string, body: string, mediaUrl?: string): Promise<void> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

    const params = new URLSearchParams({
      To: `whatsapp:${to}`,
      From: `whatsapp:${this.fromNumber}`,
      Body: body,
    });
    if (mediaUrl != null) params.append('MediaUrl', mediaUrl);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Twilio error (${response.status}): ${text}`);
    }
  }
}
