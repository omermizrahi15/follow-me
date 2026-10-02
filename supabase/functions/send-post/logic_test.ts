import { assert, assertEquals } from '@std/assert';
import { validateSendPost } from './logic.ts';

Deno.test('validateSendPost — accepts a well-formed request and passes through place', () => {
  const r = validateSendPost({ publisherId: 'p', to: '+1', mediaUrls: ['https://a', 'https://b'], place: 'Lisbon' });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.value.publisherId, 'p');
    assertEquals(r.value.to, '+1');
    assertEquals(r.value.mediaUrls, ['https://a', 'https://b']);
    assertEquals(r.value.place, 'Lisbon');
  }
});

Deno.test('validateSendPost — passes the posting id through, and stays optional', () => {
  const withId = validateSendPost({ publisherId: 'p', to: '+1', mediaUrls: ['https://a'], postingId: 'posting-abc' });
  assert(withId.ok);
  if (withId.ok) assertEquals(withId.value.postingId, 'posting-abc');

  // Builds predating the delete fix omit it; the send must still go out.
  const without = validateSendPost({ publisherId: 'p', to: '+1', mediaUrls: ['https://a'] });
  assert(without.ok);
  if (without.ok) assertEquals(without.value.postingId, undefined);
});

Deno.test('validateSendPost — rejects missing fields and empty media', () => {
  assertEquals(validateSendPost({ to: '+1', mediaUrls: ['https://a'] }).ok, false);
  assertEquals(validateSendPost({ publisherId: 'p', mediaUrls: ['https://a'] }).ok, false);
  assertEquals(validateSendPost({ publisherId: 'p', to: '+1', mediaUrls: [] }).ok, false);
  assertEquals(validateSendPost({ publisherId: 'p', to: '+1' }).ok, false); // mediaUrls not an array
});

Deno.test('validateSendPost — rejects non-https or non-string media URLs', () => {
  const bad = validateSendPost({ publisherId: 'p', to: '+1', mediaUrls: ['https://a', 'http://insecure'] });
  assertEquals(bad.ok, false);
  if (!bad.ok) assert(bad.error.includes('https'));
  assertEquals(validateSendPost({ publisherId: 'p', to: '+1', mediaUrls: ['https://a', 42] }).ok, false);
});

// Issue #220 — the optional caption is untrusted input, so it is cleaned here
// the same way the app cleans it before sending.
Deno.test('validateSendPost — passes a caption through, trimmed', () => {
  const r = validateSendPost({ publisherId: 'p', to: '+1', mediaUrls: ['https://a'], caption: '  Made it 🏔️  ' });
  assert(r.ok);
  if (r.ok) assertEquals(r.value.caption, 'Made it 🏔️');
});

Deno.test('validateSendPost — a blank or non-string caption is no caption', () => {
  for (const caption of ['', '  \n ', 42, null, undefined]) {
    const r = validateSendPost({ publisherId: 'p', to: '+1', mediaUrls: ['https://a'], caption });
    assert(r.ok);
    if (r.ok) assertEquals(r.value.caption, undefined);
  }
});

Deno.test('validateSendPost — caps an over-long caption', () => {
  const r = validateSendPost({ publisherId: 'p', to: '+1', mediaUrls: ['https://a'], caption: 'x'.repeat(1000) });
  assert(r.ok);
  if (r.ok) assertEquals(r.value.caption?.length, 280);
});
