// Pure request-validation logic for the subscribe service, split out of index.ts
// so it can be unit-tested without a Supabase client or Twilio env.

/** Validate + normalize a WhatsApp number to E.164 (e.g. "+972501234567"); null when implausible. */
export function normalizeWhatsApp(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s()-]/g, '');
  if (!/^\+?[1-9]\d{7,14}$/.test(cleaned)) return null;
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}
