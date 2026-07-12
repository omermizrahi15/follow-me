// Shared logic for the inbound WhatsApp webhook (Deno runtime).
//
// This mirrors the unit-tested TypeScript in src/ (parseInboundCommand,
// optOutMessages, twilioSignature) — the edge function can't import the RN app's
// extensionless modules, so the canonical algorithms live there with full Jest
// coverage and are reproduced here for the Deno runtime. Keep the two in sync.

export type InboundCommand =
  | { kind: 'stop' }
  | { kind: 'start' }
  | { kind: 'join'; publisherId: string }
  | { kind: 'unknown' };

/** Flattens a Twilio webhook's form-encoded POST into a string map (drops File entries). */
export function formToParams(form: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') params[key] = value;
  }
  return params;
}

const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_KEYWORDS = new Set(['START', 'UNSTOP', 'YES', 'SUBSCRIBE']);

export function parseInboundCommand(rawBody: string): InboundCommand {
  const normalized = (rawBody ?? '').trim().replace(/\s+/g, ' ');
  if (normalized === '') return { kind: 'unknown' };

  const upper = normalized.toUpperCase();
  if (STOP_KEYWORDS.has(upper)) return { kind: 'stop' };
  if (START_KEYWORDS.has(upper)) return { kind: 'start' };

  const joinMatch = /^JOIN (\S+)$/i.exec(normalized);
  if (joinMatch) return { kind: 'join', publisherId: joinMatch[1] as string };

  return { kind: 'unknown' };
}

export function composeUnsubscribeConfirmation(publisherName: string): string {
  return `You've been unsubscribed from ${publisherName}. Reply START to re-subscribe.`;
}

export function composeResubscribeConfirmation(publisherName: string): string {
  return `You're following ${publisherName} again. Reply STOP at any time to unsubscribe.`;
}

// --- Twilio request signature (Web Crypto HMAC-SHA1) -----------------------
// data = URL + each POST param (sorted by name) as name+value, no separators.
// HMAC-SHA1 keyed with the auth token, base64-encoded. Mirror of
// src/infrastructure/notifiers/twilioSignature.ts.

export async function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): Promise<string> {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map(key => key + params[key])
      .join('');

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return base64(new Uint8Array(sigBuf));
}

export async function verifyTwilioSignature(args: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string | null | undefined;
}): Promise<boolean> {
  const { authToken, url, params, signature } = args;
  if (!signature) return false;
  const expected = await computeTwilioSignature(authToken, url, params);
  return timingSafeEqual(expected, signature);
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// Length-independent constant-time-ish compare.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
