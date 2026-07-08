// Delivery tracking for outbound WhatsApp messages (issue #24).
//
// Every accepted Twilio send gets a `message_logs` row keyed by message SID;
// the `twilio-status` edge function updates the row as Twilio reports
// queued → sent → delivered/failed. No supabase-js import here on purpose —
// the client is injected, which keeps this file importable from jest tests.

/**
 * Structural stand-in for TwilioSendError from ./twilio.ts — not imported so
 * this file stays free of extensioned Deno imports (jest/ts-jest can't parse
 * them; parity tests under src/ import this file directly).
 */
export interface SendFailure {
  message: string;
  status: number | null;
  twilioCode: number | null;
}

/** The narrow slice of the supabase-js client this module needs. */
export interface DbResult {
  error: { message: string } | null;
}
export interface DbFilter extends PromiseLike<DbResult> {
  eq(column: string, value: string): DbFilter;
}
export interface DbClient {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<DbResult>;
    update(values: Record<string, unknown>): DbFilter;
  };
}

export interface MessageLogEntry {
  sid: string;
  publisherId: string;
  contactHandle: string;
  /** Twilio's initial lifecycle state for an accepted message. */
  status?: string;
}

/** Records an accepted send. Best-effort: a logging failure never breaks delivery. */
export async function logAcceptedSend(db: DbClient, entry: MessageLogEntry): Promise<void> {
  const { error } = await db.from('message_logs').insert({
    message_sid: entry.sid,
    publisher_id: entry.publisherId,
    contact_handle: entry.contactHandle,
    status: entry.status ?? 'queued',
  });
  if (error) console.error('message_logs insert failed:', error.message);
}

/** Records a send Twilio rejected outright (no SID assigned). */
export async function logRejectedSend(
  db: DbClient,
  entry: { publisherId: string; contactHandle: string; error: SendFailure },
): Promise<void> {
  const { error } = await db.from('message_logs').insert({
    // Twilio never assigned a SID; synthesize a unique key so the row still lands.
    message_sid: `rejected-${crypto.randomUUID()}`,
    publisher_id: entry.publisherId,
    contact_handle: entry.contactHandle,
    status: 'failed',
    error_code: entry.error.twilioCode != null ? String(entry.error.twilioCode) : String(entry.error.status ?? ''),
    detail: entry.error.message.slice(0, 500),
  });
  if (error) console.error('message_logs insert failed:', error.message);
}

/**
 * Marks every subscription of this contact under this publisher `unreachable`,
 * so future batches skip the number and the publisher sees it in the app.
 * Only `active` rows transition — a `revoked` (opted-out) row keeps its more
 * meaningful status.
 */
export async function markSubscriberUnreachable(
  db: DbClient,
  publisherId: string,
  contactHandle: string,
): Promise<void> {
  const { error } = await db
    .from('subscribers')
    .update({ status: 'unreachable' })
    .eq('publisher_id', publisherId)
    .eq('contact_handle', contactHandle)
    .eq('status', 'active');
  if (error) console.error('subscribers unreachable update failed:', error.message);
}

/**
 * Terminal Twilio delivery states. `undelivered`/`failed` end a message's
 * lifecycle; everything else (queued, sent, delivered, read) is progress.
 */
export function isFailureStatus(messageStatus: string): boolean {
  return messageStatus === 'failed' || messageStatus === 'undelivered';
}

/**
 * Error codes that mean the RECIPIENT is unreachable (invalid / non-WhatsApp /
 * blocked number) rather than a message-level or session-level problem.
 * Deliberately conservative: 63016 (outside the 24h session window) and rate
 * errors are NOT here — those say nothing about the number itself.
 *
 * 21211 invalid 'To' number · 21610 recipient opted out (STOP) ·
 * 21614 not a mobile number · 63003 channel can't find the recipient ·
 * 63024 invalid recipient.
 */
const UNREACHABLE_ERROR_CODES = new Set([21211, 21610, 21614, 63003, 63024]);

export function isUnreachableErrorCode(errorCode: number | null): boolean {
  return errorCode != null && UNREACHABLE_ERROR_CODES.has(errorCode);
}
