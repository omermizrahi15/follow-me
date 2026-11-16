/** Constant-time compare of the webhook's Authorization header to the shared secret. */
export function isAuthorized(header: string | null, secret: string): boolean {
  if (secret === '' || header == null) return false;
  const expected = new TextEncoder().encode(`Bearer ${secret}`);
  const actual = new TextEncoder().encode(header);
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= (expected[i] ?? 0) ^ (actual[i] ?? 0);
  return diff === 0;
}
