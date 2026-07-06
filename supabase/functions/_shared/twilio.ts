// Deno port of src/infrastructure/notifiers/TwilioClientAdapter.ts.
// Plain fetch + btoa, both available in Deno.

export interface TwilioCreds {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export async function sendWhatsApp(
  creds: TwilioCreds,
  to: string,
  body: string,
  mediaUrl?: string,
): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;
  const params = new URLSearchParams({
    To: `whatsapp:${to}`,
    From: `whatsapp:${creds.fromNumber}`,
    Body: body,
  });
  if (mediaUrl != null) params.append('MediaUrl', mediaUrl);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${creds.accountSid}:${creds.authToken}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`Twilio error (${res.status}): ${await res.text()}`);
  }
}

export interface BatchSendResult {
  sent: number;
  failed: number;
  errors: string[];
}

/**
 * Sends a batch of photo URLs to one subscriber. Twilio WhatsApp allows one
 * MediaUrl per message: the first carries the caption, the rest carry only media.
 *
 * Messages are paced (default ~1.1s apart) because Twilio throttles WhatsApp
 * to ~1 msg/sec — rapid-fire batches silently drop messages. A failed message
 * is recorded and the batch continues, so one bad send doesn't lose the rest.
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
  for (let i = 0; i < mediaUrls.length; i++) {
    try {
      await sendWhatsApp(creds, to, i === 0 ? caption : '', mediaUrls[i]);
      sent++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
    if (i < mediaUrls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, pauseMs));
    }
  }
  return { sent, failed: errors.length, errors };
}
