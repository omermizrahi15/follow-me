import { assertEquals } from '@std/assert';
import { postedPushContent, postFailedPushContent, publishablePhotos } from './logic.ts';

Deno.test('postedPushContent — pluralises photos and followers', () => {
  assertEquals(postedPushContent(1, 1).title, 'Posted 1 photo ✅');
  assertEquals(postedPushContent(3, 1).title, 'Posted 3 photos ✅');
  assertEquals(postedPushContent(3, 1).body, 'Sent to 1 follower. Tap to view.');
  assertEquals(postedPushContent(3, 4).body, 'Sent to 4 followers. Tap to view.');
});

Deno.test('postedPushContent — names the place when the batch had GPS', () => {
  assertEquals(postedPushContent(2, 5, 'Tel Aviv').title, 'Posted 2 photos from Tel Aviv ✅');
  // Blank/absent places must not leave a dangling "from".
  assertEquals(postedPushContent(2, 5, '   ').title, 'Posted 2 photos ✅');
  assertEquals(postedPushContent(2, 5, null).title, 'Posted 2 photos ✅');
});

Deno.test('postedPushContent — a publisher with no followers still gets a real post to view', () => {
  assertEquals(postedPushContent(2, 0).body, 'No followers yet — tap to see your post.');
});

Deno.test('postFailedPushContent — points back at the manual path', () => {
  assertEquals(postFailedPushContent().title, "Couldn't post your photos");
});

Deno.test('publishablePhotos — keeps well-formed entries', () => {
  assertEquals(
    publishablePhotos([{ id: 'a', url: 'https://cdn/a.jpg', createdAt: 1700000000000 }]),
    [{ id: 'a', url: 'https://cdn/a.jpg', createdAt: 1700000000000 }],
  );
});

Deno.test('publishablePhotos — drops entries publishing cannot use', () => {
  const kept = publishablePhotos([
    { id: '', url: 'https://cdn/a.jpg', createdAt: 1 },      // no asset id
    { id: 'b', url: 'ph://local-asset', createdAt: 1 },      // device handle, not a cloud copy
    { id: 'c', url: '', createdAt: 1 },                      // never uploaded
    'not-an-object',
    null,
    { id: 'd', url: 'https://cdn/d.jpg', createdAt: 1 },
  ]);
  assertEquals(kept.map(p => p.id), ['d']);
});

Deno.test('publishablePhotos — tolerates a non-array batch', () => {
  assertEquals(publishablePhotos(null), []);
  assertEquals(publishablePhotos({ batch: [] }), []);
});
