import { assert, assertEquals } from '@std/assert';
import {
  buildPrompt,
  CANDIDATE_COUNT,
  MAX_LIST,
  MAX_PHOTOS,
  normalizeCandidates,
  sanitizePhotos,
  sanitizeTracks,
} from './logic.ts';

Deno.test('sanitizeTracks — keeps well-formed tracks, drops junk, caps the list', () => {
  const tracks = sanitizeTracks([
    { title: ' Vienna ', artist: 'Billy Joel' },
    { title: '', artist: 'X' },
    { artist: 'No Title' },
    'not-an-object',
    null,
  ]);
  assertEquals(tracks, [{ title: 'Vienna', artist: 'Billy Joel' }]);

  const many = sanitizeTracks(Array.from({ length: MAX_LIST + 10 }, (_, i) => ({ title: `t${i}`, artist: 'a' })));
  assertEquals(many.length, MAX_LIST);
});

Deno.test('sanitizeTracks — non-array input yields an empty list', () => {
  assertEquals(sanitizeTracks(undefined), []);
  assertEquals(sanitizeTracks('nope'), []);
  assertEquals(sanitizeTracks({ title: 'x', artist: 'y' }), []);
});

Deno.test('sanitizePhotos — keeps base64 photos, defaults mime, caps at MAX_PHOTOS', () => {
  const photos = sanitizePhotos([
    { base64: 'aaa', mimeType: 'image/png' },
    { base64: 'bbb', mimeType: 'application/pdf' }, // non-image mime → default
    { base64: '' }, // dropped
    { mimeType: 'image/jpeg' }, // no bytes → dropped
  ]);
  assertEquals(photos, [
    { base64: 'aaa', mimeType: 'image/png' },
    { base64: 'bbb', mimeType: 'image/jpeg' },
  ]);

  const many = sanitizePhotos(Array.from({ length: MAX_PHOTOS + 2 }, (_, i) => ({ base64: `p${i}` })));
  assertEquals(many.length, MAX_PHOTOS);
});

Deno.test('buildPrompt — photos outrank other signals when attached', () => {
  const prompt = buildPrompt({ place: 'Lisbon, Portugal', photoAttached: true, exclude: [], seeds: [] });
  assert(prompt.includes('photos are attached'));
  assert(prompt.includes('outrank'));
  assert(prompt.includes('Lisbon, Portugal'));
});

Deno.test('buildPrompt — no-context fallback only when nothing is known', () => {
  const bare = buildPrompt({ photoAttached: false, exclude: [], seeds: [] });
  assert(bare.includes('No context known'));

  const withPhotos = buildPrompt({ photoAttached: true, exclude: [], seeds: [] });
  assert(!withPhotos.includes('No context known'));
});

Deno.test('buildPrompt — seeds and excludes are listed with their intent', () => {
  const prompt = buildPrompt({
    photoAttached: false,
    seeds: [{ title: 'Vienna', artist: 'Billy Joel' }],
    exclude: [{ title: 'Yellow', artist: 'Coldplay' }],
  });
  assert(prompt.includes('recently played'));
  assert(prompt.includes('"Vienna" by Billy Joel'));
  assert(prompt.includes('do NOT repeat'));
  assert(prompt.includes('"Yellow" by Coldplay'));
});

Deno.test('normalizeCandidates — trims, drops malformed, caps at CANDIDATE_COUNT', () => {
  const candidates = normalizeCandidates([
    { title: ' Vienna ', artist: 'Billy Joel', reason: ' classic ' },
    { title: '', artist: 'X', reason: 'r' },
    { artist: 'No Title', reason: 'r' },
    { title: 'No Reason', artist: 'Y' },
    'junk',
  ]);
  assertEquals(candidates, [
    { title: 'Vienna', artist: 'Billy Joel', reason: 'classic' },
    { title: 'No Reason', artist: 'Y', reason: '' },
  ]);

  const many = normalizeCandidates(
    Array.from({ length: CANDIDATE_COUNT + 3 }, (_, i) => ({ title: `t${i}`, artist: 'a', reason: 'r' })),
  );
  assertEquals(many.length, CANDIDATE_COUNT);
});

Deno.test('normalizeCandidates — non-array input yields an empty list', () => {
  assertEquals(normalizeCandidates(undefined), []);
  assertEquals(normalizeCandidates({ title: 'x' }), []);
});
