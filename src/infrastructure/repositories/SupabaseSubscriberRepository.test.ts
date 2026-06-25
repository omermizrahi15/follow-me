// Unit test for the read contract that the Followers list depends on. The
// actual RLS-empty-reads bug is DB-level (see the integration test), but these
// lock the query shape: reads must filter to the publisher's *active* rows, and
// an empty result (what RLS returned before the select policy) maps to [].

jest.mock('@supabase/supabase-js', () => {
  const state: { result: { data: unknown; error: unknown }; eqCalls: Array<[string, unknown]>; table: string | null } = {
    result: { data: [], error: null },
    eqCalls: [],
    table: null,
  };
  interface QueryBuilder {
    select: () => QueryBuilder;
    eq: (column: string, value: unknown) => QueryBuilder;
    single: () => QueryBuilder;
    then: (resolve: (v: unknown) => void) => void;
  }
  const builder: QueryBuilder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      state.eqCalls.push([column, value]);
      return builder;
    },
    single: () => builder,
    then: (resolve: (v: unknown) => void): void => resolve(state.result),
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

import { SupabaseSubscriberRepository } from './SupabaseSubscriberRepository';
import * as supabase from '@supabase/supabase-js';

const state = (supabase as unknown as {
  __state: { result: { data: unknown; error: unknown }; eqCalls: Array<[string, unknown]>; table: string | null };
}).__state;

function makeRepo(): SupabaseSubscriberRepository {
  return new SupabaseSubscriberRepository('https://example.supabase.co', 'anon-key');
}

beforeEach(() => {
  state.result = { data: [], error: null };
  state.eqCalls = [];
  state.table = null;
});

describe('SupabaseSubscriberRepository.findActiveByPublisher', () => {
  it('queries the subscribers table filtered to the publisher and active status', async (): Promise<void> => {
    await makeRepo().findActiveByPublisher('pub-1');
    expect(state.table).toBe('subscribers');
    expect(state.eqCalls).toContainEqual(['publisher_id', 'pub-1']);
    expect(state.eqCalls).toContainEqual(['status', 'active']);
  });

  it('maps returned rows to Subscriber entities', async (): Promise<void> => {
    state.result = {
      data: [{ id: 's1', publisher_id: 'pub-1', contact_handle: '+972500000001', status: 'active' }],
      error: null,
    };
    const subs = await makeRepo().findActiveByPublisher('pub-1');
    expect(subs).toHaveLength(1);
    expect(subs[0]?.id).toBe('s1');
    expect(subs[0]?.contactHandle).toBe('+972500000001');
    expect(subs[0]?.isActive()).toBe(true);
  });

  it('returns an empty list when the query yields no rows (e.g. RLS blocked reads)', async (): Promise<void> => {
    state.result = { data: [], error: null };
    const subs = await makeRepo().findActiveByPublisher('pub-1');
    expect(subs).toEqual([]);
  });

  it('throws when the query errors', async (): Promise<void> => {
    state.result = { data: null, error: { message: 'permission denied' } };
    await expect(makeRepo().findActiveByPublisher('pub-1')).rejects.toThrow('permission denied');
  });
});
