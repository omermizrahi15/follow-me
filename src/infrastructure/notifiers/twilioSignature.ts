// Validates Twilio's X-Twilio-Signature header so the webhook can't be spoofed.
//
// Twilio signs each request by concatenating the full request URL with every
// POST parameter — sorted by name, each name immediately followed by its value,
// no separators — then HMAC-SHA1 with the account's auth token as the key, and
// base64-encodes the result. We recompute it and compare in constant time.
// See https://www.twilio.com/docs/usage/security#validating-requests
//
// Node-only (uses node:crypto) — runs in tests and any server context, never in
// the React Native bundle. The edge-function runtime carries its own Web Crypto
// implementation of the same algorithm.

import { createHmac, timingSafeEqual } from 'crypto';

export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map(key => key + params[key])
      .join('');
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export function verifyTwilioSignature(args: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string | null | undefined;
}): boolean {
  const { authToken, url, params, signature } = args;
  if (!signature) return false;

  const expected = computeTwilioSignature(authToken, url, params);

  // Constant-time compare; bail first if lengths differ (timingSafeEqual throws
  // on length mismatch).
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
