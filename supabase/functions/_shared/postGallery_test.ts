import { assert, assertEquals } from '@std/assert';
import { publisherGalleryUrl, savePostGallery } from './postGallery.ts';

interface Upsert { row: Record<string, unknown> }

/** Records every upsert; `failWhen` rejects the ones a real PostgREST would. */
function fakeSupabase(failWhen: (row: Record<string, unknown>) => boolean = () => false) {
  const upserts: Upsert[] = [];
  const client = {
    from(table: string) {
      assertEquals(table, 'posts');
      return {
        upsert(row: Record<string, unknown>) {
          upserts.push({ row });
          return Promise.resolve(
            failWhen(row) ? { error: { message: `column "${Object.keys(row).at(-1)}" does not exist` } } : { error: null },
          );
        },
      };
    },
  };
  return { client, upserts };
}

Deno.test('savePostGallery — stores the posting id so the post can be trashed later', async () => {
  const { client, upserts } = fakeSupabase();

  const url = await savePostGallery(client, 'pub-1', ['https://a', 'https://b'], 'Lisbon', 'posting-abc');

  assert(url != null);
  assertEquals(upserts.length, 1);
  assertEquals(upserts[0].row.posting_id, 'posting-abc');
  assertEquals(upserts[0].row.publisher_id, 'pub-1');
  assertEquals(upserts[0].row.place, 'Lisbon');
});

Deno.test('savePostGallery — same publisher + urls always hash to one row', async () => {
  const { client } = fakeSupabase();

  const first = await savePostGallery(client, 'pub-1', ['https://a'], null, 'posting-abc');
  const second = await savePostGallery(client, 'pub-1', ['https://a'], null, 'posting-abc');
  const other = await savePostGallery(client, 'pub-1', ['https://b'], null, 'posting-xyz');

  assertEquals(first, second);
  assert(first !== other);
});

Deno.test('savePostGallery — omits the posting id entirely when there is none', async () => {
  // A column the environment may not have yet must not appear in the row at
  // all, or the upsert fails for postings that never had an id to send.
  const { client, upserts } = fakeSupabase();

  await savePostGallery(client, 'pub-1', ['https://a']);

  assert(!('posting_id' in upserts[0].row));
});

Deno.test('savePostGallery — still returns a link against a database without posting_id', async () => {
  // Migration 20240032 may not have reached this environment: losing the
  // gallery link on every message would be far worse than an untrashable post.
  const { client, upserts } = fakeSupabase(row => 'posting_id' in row);

  const url = await savePostGallery(client, 'pub-1', ['https://a'], null, 'posting-abc');

  assert(url != null);
  assertEquals(upserts.length, 2);
  assert(!('posting_id' in upserts[1].row));
});

Deno.test('savePostGallery — returns null rather than blocking the send when the write fails', async () => {
  const { client } = fakeSupabase(() => true);

  assertEquals(await savePostGallery(client, 'pub-1', ['https://a'], null, 'posting-abc'), null);
});

Deno.test('publisherGalleryUrl — points at the feed view, not a single post', () => {
  const url = publisherGalleryUrl('pub-1');

  assert(url.endsWith('?u=pub-1'));
  assert(url.startsWith('https://'));
});

Deno.test('publisherGalleryUrl — escapes the publisher id it puts in the query', () => {
  assert(publisherGalleryUrl('a b&c').endsWith('?u=a%20b%26c'));
});

Deno.test('publisherGalleryUrl — shares its base with the per-post links', async () => {
  const { client } = fakeSupabase();
  const postUrl = await savePostGallery(client, 'pub-1', ['https://a']);

  const base = (u: string) => u.split('?')[0];
  assertEquals(base(publisherGalleryUrl('pub-1')), base(postUrl ?? ''));
});
