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

/**
 * Sends a batch of photo URLs to one subscriber. Twilio WhatsApp allows one
 * MediaUrl per message: the first carries the caption, the rest carry only media.
 * Mirrors WhatsAppNotifier.notify().
 */
export async function sendBatch(
  creds: TwilioCreds,
  to: string,
  caption: string,
  mediaUrls: string[],
): Promise<void> {
  const [first, ...rest] = mediaUrls;
  await sendWhatsApp(creds, to, caption, first);
  for (const u of rest) {
    await sendWhatsApp(creds, to, '', u);
  }
}
