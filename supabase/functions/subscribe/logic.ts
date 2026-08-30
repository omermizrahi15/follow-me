// Pure request-validation logic for the subscribe service, split out of index.ts
// so it can be unit-tested without a Supabase client or Twilio env.

/** Validate + normalize a WhatsApp number to E.164 (e.g. "+972501234567"); null when implausible. */
export function normalizeWhatsApp(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s()-]/g, '');
  if (!/^\+?[1-9]\d{7,14}$/.test(cleaned)) return null;
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

/** What a subscribe request should do, given the row (if any) already on file. */
export type SubscribeAction = 'insert' | 'reactivate' | 'already-active';

/**
 * Decide how to handle a subscribe for a publisher/number pair.
 *
 * Someone who is already active is re-subscribing — often because they lost the
 * confirmation and want to check they're on the list. That needs no write and
 * no second welcome (on a production sender that welcome costs a template
 * message and reads as spam); the page just tells them they're already in.
 * Any other status — revoked after a STOP, pending, or unreachable — is a real
 * re-subscribe and gets reactivated and welcomed.
 */
export function subscribeAction(existing: { status: string } | null): SubscribeAction {
  if (!existing) return 'insert';
  return existing.status === 'active' ? 'already-active' : 'reactivate';
}
