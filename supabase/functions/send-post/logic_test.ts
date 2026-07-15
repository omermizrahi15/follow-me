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

Deno.test('validateSendPost — passes through a well-formed song', () => {
  const song = {
    title: 'Vienna',
    artist: 'Billy Joel',
    previewUrl: 'https://preview/vienna.m4a',
  };
  const r = validateSendPost({ publisherId: 'p', to: '+1', mediaUrls: ['https://a'], song });
  assert(r.ok);
  if (r.ok) assertEquals(r.value.song, song);
});

Deno.test('validateSendPost — a malformed song becomes null, never a rejection', () => {
  for (const song of [undefined, null, 'Vienna', { title: 'Vienna' }, { title: '', artist: 'X' }]) {
    const r = validateSendPost({ publisherId: 'p', to: '+1', mediaUrls: ['https://a'], song });
    assert(r.ok);
    if (r.ok) assertEquals(r.value.song, null);
  }
});

Deno.test('validateSendPost — drops non-https song URLs but keeps the song', () => {
  const r = validateSendPost({
    publisherId: 'p',
    to: '+1',
    mediaUrls: ['https://a'],
    song: { title: 'Vienna', artist: 'Billy Joel', previewUrl: 'http://insecure/x.m4a' },
  });
  assert(r.ok);
  if (r.ok) assertEquals(r.value.song, { title: 'Vienna', artist: 'Billy Joel' });
});
