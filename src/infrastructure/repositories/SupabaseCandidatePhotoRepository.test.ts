// The ⚡ test notification (and anything else resolving a chosen batch to cloud
// copies) needs to go from asset ids -> uploaded URLs. Device-scanned batches hold
// iOS `ph://` uris, which are useless to a notification extension; the uploaded
// Cloudinary copy is keyed by the same asset id in `candidate_photos` (issue #85).

import { SupabaseCandidatePhotoRepository } from './SupabaseCandidatePhotoRepository';
import { recordingClient, type RecordedQuery } from '../../test-support/supabase';

let recorded: RecordedQuery;

function makeRepo(): SupabaseCandidatePhotoRepository {
  const fake = recordingClient();
  recorded = fake.recorded;
  return new SupabaseCandidatePhotoRepository(fake.client);
}

describe('SupabaseCandidatePhotoRepository.urlsByAssetIds', () => {
  it('maps asset ids to their uploaded urls, scoped to the publisher', async () => {
    const repo = makeRepo();
    recorded.result = {
      data: [
        { asset_id: 'a', url: 'https://cdn/a.jpg' },
        { asset_id: 'b', url: 'https://cdn/b.jpg' },
      ],
      error: null,
    };

    const urls = await repo.urlsByAssetIds('pub-1', ['a', 'b']);

    expect(recorded.table).toBe('candidate_photos');
    expect(recorded.eqCalls).toContainEqual(['publisher_id', 'pub-1']);
    expect(recorded.inCalls).toContainEqual(['asset_id', ['a', 'b']]);
    expect(urls.get('a')).toBe('https://cdn/a.jpg');
    expect(urls.get('b')).toBe('https://cdn/b.jpg');
  });

  it('omits ids with no uploaded copy rather than inventing one', async () => {
    const repo = makeRepo();
    recorded.result = { data: [{ asset_id: 'a', url: 'https://cdn/a.jpg' }], error: null };

    const urls = await repo.urlsByAssetIds('pub-1', ['a', 'missing']);

    expect(urls.get('a')).toBe('https://cdn/a.jpg');
    expect(urls.has('missing')).toBe(false);
    expect(urls.size).toBe(1);
  });

  it('short-circuits without querying when given no ids', async () => {
    const repo = makeRepo();

    const urls = await repo.urlsByAssetIds('pub-1', []);

    expect(urls.size).toBe(0);
    expect(recorded.table).toBeNull();
  });

  it('throws when the query fails, so callers do not treat it as "no photos"', async () => {
    const repo = makeRepo();
    recorded.result = { data: null, error: { message: 'boom' } };

    await expect(repo.urlsByAssetIds('pub-1', ['a'])).rejects.toThrow('boom');
  });
});
