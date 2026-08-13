import { assert, assertEquals } from '@std/assert';
import { ageCutoffIso, cloudinaryDestroySignature, publicIdFromUrl, sha1Hex } from './logic.ts';

Deno.test('publicIdFromUrl — extracts the public id (no version, no extension)', () => {
  assertEquals(
    publicIdFromUrl('https://res.cloudinary.com/demo/image/upload/v1699999999/photo.jpg'),
    'photo',
  );
});

Deno.test('publicIdFromUrl — keeps the folder path and survives transform segments', () => {
  assertEquals(
    publicIdFromUrl('https://res.cloudinary.com/demo/image/upload/f_jpg,q_auto/v123/trips/lisbon/pic.png'),
    'trips/lisbon/pic',
  );
});

Deno.test('publicIdFromUrl — null for a non-Cloudinary-upload URL', () => {
  assertEquals(publicIdFromUrl('https://example.com/photo.jpg'), null);
});

Deno.test('sha1Hex — matches known SHA-1 vectors', async () => {
  assertEquals(await sha1Hex(''), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  assertEquals(await sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
});

Deno.test('cloudinaryDestroySignature — signs the sorted params + secret deterministically', async () => {
  const sig = await cloudinaryDestroySignature('trips/pic', 1700000000, 'SECRET');
  assertEquals(sig, await sha1Hex('public_id=trips/pic&timestamp=1700000000SECRET'));
  assert(/^[0-9a-f]{40}$/.test(sig), 'is a 40-char hex digest');
});

Deno.test('ageCutoffIso — a positive day count scopes the delete to older rows', () => {
  const now = Date.parse('2026-08-12T00:00:00.000Z');
  assertEquals(ageCutoffIso({ olderThanDays: 7 }, now), '2026-08-05T00:00:00.000Z');
});

Deno.test('ageCutoffIso — no scope means the full wipe the privacy control asks for', () => {
  const now = Date.parse('2026-08-12T00:00:00.000Z');
  for (const body of [{}, null, undefined, { olderThanDays: '7' }, { olderThanDays: 0 }, { olderThanDays: -3 }, { olderThanDays: NaN }]) {
    assertEquals(ageCutoffIso(body, now), null, `body ${JSON.stringify(body)} must not narrow the wipe`);
  }
});
