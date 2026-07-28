// The ⚡ test notification (and anything else resolving a chosen batch to cloud
// copies) needs to go from asset ids -> uploaded URLs. Device-scanned batches hold
// iOS `ph://` uris, which are useless to a notification extension; the uploaded
// Cloudinary copy is keyed by the same asset id in `candidate_photos` (issue #85).

jest.mock('@supabase/supabase-js', () => {
  const state: {
    result: { data: unknown; error: unknown };
    table: string | null;
    eqCalls: Array<[string, unknown]>;
    inCalls: Array<[string, unknown]>;
  } = { result: { data: [], error: null }, table: null, eqCalls: [], inCalls: [] };
  interface QueryBuilder {
    select: () => QueryBuilder;
    eq: (column: string, value: unknown) => QueryBuilder;
    in: (column: string, values: unknown) => QueryBuilder;
    then: (resolve: (v: unknown) => void) => void;
  }
  const builder: QueryBuilder = {
    select: () => builder,
    eq: (column, value) => {
      state.eqCalls.push([column, value]);
      return builder;
    },
    in: (column, values) => {
      state.inCalls.push([column, values]);
      return builder;
    },
    then: (resolve): void => resolve(state.result),
  };
  return {
    createClient: () => ({
      from: (table: string) => {
        state.table = table;
        return builder;
      },
    }),
    __state: state,
  };
});

import { SupabaseCandidatePhotoRepository } from './SupabaseCandidatePhotoRepository';
import * as supabase from '@supabase/supabase-js';

const state = (supabase as unknown as {
  __state: {
    result: { data: unknown; error: unknown };
    table: string | null;
    eqCalls: Array<[string, unknown]>;
    inCalls: Array<[string, unknown]>;
  };
}).__state;

function makeRepo(): SupabaseCandidatePhotoRepository {
  return new SupabaseCandidatePhotoRepository('https://example.supabase.co', 'anon-key');
}

beforeEach(() => {
  state.result = { data: [], error: null };
  state.table = null;
  state.eqCalls = [];
  state.inCalls = [];
});

describe('SupabaseCandidatePhotoRepository.urlsByAssetIds', () => {
  it('maps asset ids to their uploaded urls, scoped to the publisher', async () => {
    state.result = {
      data: [
        { asset_id: 'a', url: 'https://cdn/a.jpg' },
        { asset_id: 'b', url: 'https://cdn/b.jpg' },
      ],
      error: null,
    };

    const urls = await makeRepo().urlsByAssetIds('pub-1', ['a', 'b']);

    expect(state.table).toBe('candidate_photos');
    expect(state.eqCalls).toContainEqual(['publisher_id', 'pub-1']);
    expect(state.inCalls).toContainEqual(['asset_id', ['a', 'b']]);
    expect(urls.get('a')).toBe('https://cdn/a.jpg');
    expect(urls.get('b')).toBe('https://cdn/b.jpg');
  });

  it('omits ids with no uploaded copy rather than inventing one', async () => {
    state.result = { data: [{ asset_id: 'a', url: 'https://cdn/a.jpg' }], error: null };

    const urls = await makeRepo().urlsByAssetIds('pub-1', ['a', 'missing']);

    expect(urls.get('a')).toBe('https://cdn/a.jpg');
    expect(urls.has('missing')).toBe(false);
    expect(urls.size).toBe(1);
  });

  it('short-circuits without querying when given no ids', async () => {
    const urls = await makeRepo().urlsByAssetIds('pub-1', []);

    expect(urls.size).toBe(0);
    expect(state.table).toBeNull();
  });

  it('throws when the query fails, so callers do not treat it as "no photos"', async () => {
    state.result = { data: null, error: { message: 'boom' } };

    await expect(makeRepo().urlsByAssetIds('pub-1', ['a'])).rejects.toThrow('boom');
  });
});
