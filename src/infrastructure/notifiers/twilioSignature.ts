// Validates Twilio's X-Twilio-Signature header so the webhook can't be spoofed.
//
// Twilio signs each request by concatenating the full request URL with every
// POST parameter — sorted by name, each name immediately followed by its value,
// no separators — then HMAC-SHA1 with the account's auth token as the key, and
// base64-encodes the result. We recompute it and compare in constant time.
// See https://www.twilio.com/docs/usage/security#validating-requests
//
// DUAL RUNTIME — the `join-webhook` and `twilio-status` Edge Functions are what
// actually verify inbound Twilio requests, and import this exact file. It is
// therefore built on Web Crypto (`crypto.subtle`, present in Deno and in Node
// 18+) rather than `node:crypto`, and stays import-free; see CONTRIBUTING.md.
// Signing is asynchronous as a result.

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
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return base64(new Uint8Array(signature));
}

export async function verifyTwilioSignature(args: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string | null | undefined;
}): Promise<boolean> {
  const { authToken, url, params, signature } = args;
  if (signature == null || signature === '') return false;
  const expected = await computeTwilioSignature(authToken, url, params);
  return timingSafeEqual(expected, signature);
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Constant-time compare of two same-length strings. Bails on a length mismatch
 * first — that leaks only the length, and a base64 HMAC-SHA1 is always 28
 * characters, so a wrong length is not a secret worth protecting.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
