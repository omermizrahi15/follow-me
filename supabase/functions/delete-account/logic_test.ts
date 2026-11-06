import { assertEquals } from '@std/assert';
import { cloudinaryIdsToDestroy, USER_DATA_TABLES } from './logic.ts';

const url = (id: string) => `https://res.cloudinary.com/demo/image/upload/v123/${id}.jpg`;

Deno.test('every table that holds a user row is wiped, keyed on the right column', () => {
  const byTable = Object.fromEntries(USER_DATA_TABLES.map((t) => [t.table, t.column]));
  assertEquals(byTable, {
    posts: 'publisher_id',
    media: 'owner_id',
    candidate_photos: 'publisher_id',
    approval_batches: 'publisher_id',
    notification_deliveries: 'publisher_id',
    notification_log: 'publisher_id',
    message_logs: 'publisher_id',
    subscribers: 'publisher_id',
    publisher_config: 'publisher_id',
    publisher_profile: 'publisher_id',
    classify_quota: 'user_id',
  });
});

Deno.test('collects every Cloudinary asset the user owns, once each', () => {
  const ids = cloudinaryIdsToDestroy({
    media: [{ url: url('u/a') }, { url: url('u/b') }],
    candidates: [{ url: url('u/a') }, { url: url('u/c') }],
    posts: [{ media_urls: [url('u/b'), url('u/d')] }],
    avatars: [{ avatar_url: url('u/avatar') }],
  });
  assertEquals(ids.sort(), ['u/a', 'u/avatar', 'u/b', 'u/c', 'u/d']);
});

Deno.test('ignores rows without a usable Cloudinary url', () => {
  const ids = cloudinaryIdsToDestroy({
    media: [{ url: 'ph://local-only' }],
    candidates: [],
    posts: [{ media_urls: null }, { media_urls: 'not-an-array' as never }],
    avatars: [{ avatar_url: null }, { avatar_url: 'https://example.com/x.png' }],
  });
  assertEquals(ids, []);
});
