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

/** Flattens Twilio's form-encoded POST into a plain string map (drops File entries). */
export function formToParams(form: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') params[key] = value;
  }
  return params;
}

/** Twilio sends From as "whatsapp:+1555…"; strip the scheme to the bare handle. */
export function contactHandleFromWhatsApp(from: string): string {
  return from.replace(/^whatsapp:/, '');
}

/**
 * Publisher display name with fallbacks: metadata display_name → email local-part
 * → a generic label. `||` (not `??`) so an empty display_name falls through.
 */
export function publisherDisplayName(
  metadata: Record<string, string> | null | undefined,
  email: string | null | undefined,
): string {
  return metadata?.display_name || email?.split('@')[0] || 'your publisher';
}
