// Outbound Expo push, with the response actually read.
//
// Every push in this codebase used to be a bare `await fetch(...)` whose result
// was dropped on the floor. Expo reports per-message failures INSIDE an HTTP 200
// — a revoked token, a build whose bundle id has no APNs credentials, and a
// perfectly delivered notification are all `200 OK` at the transport layer, and
// differ only in the ticket body. So "the push was sent" was never something the
// server actually knew; it only knew the request had been accepted.
//
// That mattered while debugging the staging outage: proving no push was sent
// meant reading Edge Function logs, because nothing in the code would ever have
// said so. Now the ticket is parsed, failures are returned to the caller, and a
// token Expo calls dead is reported as such so it can be cleared.

/** A push Expo refused, named by its own error code where it gave one. */
export interface PushFailure {
  /** Expo's machine-readable ticket error, e.g. 'DeviceNotRegistered'. */
  code: string | null;
  message: string;
}

interface Ticket {
  status?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Reads a push failure out of Expo's response body, or null when it accepted.
 *
 * Two unrelated shapes have to be handled. Request-level rejections (malformed
 * body, bad content type) come back as `{ errors: [{ code, message }] }`, while
 * per-message verdicts come back under `data` — an object for a single `to`, an
 * array when several were sent at once. Only `status: 'error'` is a failure;
 * anything else, including a body we don't recognise, counts as accepted so a
 * change in Expo's envelope can never invent failures that didn't happen.
 */
export function ticketFailure(body: unknown): PushFailure | null {
  if (body == null || typeof body !== 'object') return null;

  const errors = (body as { errors?: unknown }).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as { code?: string; message?: string };
    return {
      code: typeof first?.code === 'string' ? first.code : null,
      message: typeof first?.message === 'string' ? first.message : 'Expo rejected the request',
    };
  }

  const data = (body as { data?: unknown }).data;
  const tickets: Ticket[] = Array.isArray(data)
    ? (data as Ticket[])
    : data != null && typeof data === 'object'
      ? [data as Ticket]
      : [];

  for (const ticket of tickets) {
    if (ticket?.status !== 'error') continue;
    return {
      code: typeof ticket.details?.error === 'string' ? ticket.details.error : null,
      message: typeof ticket.message === 'string' ? ticket.message : 'Expo rejected the message',
    };
  }
  return null;
}

/**
 * Whether Expo says this token will never receive anything again.
 *
 * `DeviceNotRegistered` is the app being uninstalled, the token rotated, or the
 * push credentials for that build going away — permanent, per Expo's own
 * guidance to stop sending to it. Everything else (rate limits, transient APNs
 * trouble) is worth retrying on the next tick, so it is deliberately not here.
 */
export function isTokenDead(failure: PushFailure | null): boolean {
  return failure?.code === 'DeviceNotRegistered';
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Sends one Expo push and returns why it failed, or null when it was accepted.
 *
 * Never throws: a push is a notification, not the posting itself, and a DNS
 * blip reaching Expo must not take down the run that built the batch. The
 * transport error is returned in the same shape as a ticket error so callers
 * have exactly one thing to check.
 */
export async function sendExpoPush(
  message: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<PushFailure | null> {
  let res: Response;
  try {
    res = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
  } catch (err) {
    return { code: null, message: `push transport failed: ${String(err)}` };
  }

  if (!res.ok) {
    return { code: null, message: `Expo push returned HTTP ${res.status}` };
  }

  try {
    return ticketFailure(await res.json());
  } catch {
    // Accepted at the transport layer with a body we couldn't parse. Treating
    // that as a failure would be a guess; the HTTP status is the better signal.
    return null;
  }
}
