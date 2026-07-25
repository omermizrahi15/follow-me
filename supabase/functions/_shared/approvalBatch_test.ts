import { assertEquals, assertRejects } from '@std/assert';
import { galleryUrls, PUSH_GALLERY_LIMIT, saveApprovalBatch, type ApprovalBatchPhoto } from './approvalBatch.ts';

function photo(id: string, url: string): ApprovalBatchPhoto {
  return { id, url, category: 'other', caption: '', quality: 1, scene: '', createdAt: 0 };
}

Deno.test('galleryUrls — maps to urls and caps at the gallery limit', () => {
  const batch = Array.from({ length: PUSH_GALLERY_LIMIT + 4 }, (_, i) => photo(`p${i}`, `https://cdn/${i}.jpg`));
  const urls = galleryUrls(batch);
  assertEquals(urls.length, PUSH_GALLERY_LIMIT);
  assertEquals(urls[0], 'https://cdn/0.jpg');
  assertEquals(urls.at(-1), `https://cdn/${PUSH_GALLERY_LIMIT - 1}.jpg`);
});

Deno.test('galleryUrls — returns fewer when the batch is small', () => {
  assertEquals(galleryUrls([photo('a', 'https://cdn/a.jpg')]), ['https://cdn/a.jpg']);
  assertEquals(galleryUrls([]), []);
});

Deno.test('saveApprovalBatch — inserts the row keyed by batchId', async () => {
  const captured: { table?: string; row?: unknown } = {};
  const client = {
    from(table: string) {
      captured.table = table;
      return {
        insert(row: unknown) {
          captured.row = row;
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  const batch = [photo('a', 'https://cdn/a.jpg')];
  await saveApprovalBatch(client, 'batch-1', 'pub-1', batch, []);
  assertEquals(captured.table, 'approval_batches');
  assertEquals(captured.row, { batch_id: 'batch-1', publisher_id: 'pub-1', batch, pool: [] });
});

Deno.test('saveApprovalBatch — throws when the insert fails', async () => {
  const client = {
    from() {
      return { insert: () => Promise.resolve({ error: { message: 'boom' } }) };
    },
  };
  await assertRejects(() => saveApprovalBatch(client, 'b', 'p', [], []), Error, 'boom');
});
