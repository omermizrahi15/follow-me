// Pure helpers for the join-webhook service, split out of index.ts for unit
// testing. The Supabase reads/writes and Twilio sends stay in index.ts.

/** TwiML reply body — Twilio requires text/xml for webhook responses. */
export function twiml(message: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>${message}</Message></Response>`,
    { headers: { 'content-type': 'text/xml' } },
  );
}

/** Twilio sends From as "whatsapp:+1555…"; strip the scheme to the bare handle. */
export function contactHandleFromWhatsApp(from: string): string {
  return from.replace(/^whatsapp:/, '');
}
