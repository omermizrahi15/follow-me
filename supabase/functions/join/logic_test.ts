import { assert, assertEquals } from '@std/assert';
import { handleJoin, type JoinDeps, parsePublisherId, waLink } from './logic.ts';

const deps = (exists: boolean, twilioFrom = '+14155238886'): JoinDeps => ({
  twilioFrom,
  publisherExists: (_id: string) => Promise.resolve(exists),
});

Deno.test('waLink — strips the leading + and url-encodes the JOIN message', () => {
  assertEquals(waLink('+14155238886', 'pub_1'), 'https://wa.me/14155238886?text=JOIN%20pub_1');
});

Deno.test('parsePublisherId — takes the last path segment', () => {
  assertEquals(parsePublisherId('https://x.fn/join/abc123'), 'abc123');
  assertEquals(parsePublisherId('https://x.fn/join/abc123/'), 'abc123'); // trailing slash ignored
  assertEquals(parsePublisherId('https://x.fn/join'), 'join'); // no id given
});

Deno.test('handleJoin — 405 for non-GET', async () => {
  const res = await handleJoin(new Request('https://x.fn/join/abc', { method: 'POST' }), deps(true));
  assertEquals(res.status, 405);
});

Deno.test('handleJoin — 400 when no publisher id is supplied', async () => {
  const res = await handleJoin(new Request('https://x.fn/join'), deps(true));
  assertEquals(res.status, 400);
});

Deno.test('handleJoin — 404 when the publisher does not exist', async () => {
  const res = await handleJoin(new Request('https://x.fn/join/ghost'), deps(false));
  assertEquals(res.status, 404);
});

Deno.test('handleJoin — 302 to the WhatsApp deep link for a real publisher', async () => {
  const res = await handleJoin(new Request('https://x.fn/join/pub_1'), deps(true));
  assertEquals(res.status, 302);
  assertEquals(res.headers.get('Location'), 'https://wa.me/14155238886?text=JOIN%20pub_1');
  assert(res.body === null);
});
