// Pure request logic for the `join` service, split out of index.ts so it can be
// unit-tested without starting a server or a real Supabase client. index.ts
// wires the real dependencies into `handleJoin`.

export interface JoinDeps {
  /** E.164 Twilio WhatsApp sender, e.g. +14155238886. */
  twilioFrom: string;
  /** True only when the publisher id maps to a real user. */
  publisherExists(publisherId: string): Promise<boolean>;
}

/** The wa.me deep link that pre-fills "JOIN {id}" to the Twilio number (no leading +). */
export function waLink(twilioFrom: string, publisherId: string): string {
  const number = twilioFrom.replace(/^\+/, '');
  const text = encodeURIComponent(`JOIN ${publisherId}`);
  return `https://wa.me/${number}?text=${text}`;
}

/** Publisher id is the last path segment; the function name "join" means none was given. */
export function parsePublisherId(requestUrl: string): string {
  return new URL(requestUrl).pathname.split('/').filter(Boolean).at(-1) ?? '';
}

/** GET /join/:publisherId → 302 to WhatsApp, or 400/404/405 on the failure paths. */
export async function handleJoin(req: Request, deps: JoinDeps): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }
  const publisherId = parsePublisherId(req.url);
  if (!publisherId || publisherId === 'join') {
    return new Response('This invite link is invalid.', { status: 400 });
  }
  if (!(await deps.publisherExists(publisherId))) {
    return new Response('This invite link is invalid or has expired.', { status: 404 });
  }
  return new Response(null, { status: 302, headers: { Location: waLink(deps.twilioFrom, publisherId) } });
}
