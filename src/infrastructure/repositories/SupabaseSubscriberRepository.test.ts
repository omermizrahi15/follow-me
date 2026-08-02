// Unit test for the read contract that the Followers list depends on. The
// actual RLS-empty-reads bug is DB-level (see the integration test), but these
// lock the query shape: reads must filter to the publisher's *active* rows, and
// an empty result (what RLS returned before the select policy) maps to [].

import { SupabaseSubscriberRepository } from './SupabaseSubscriberRepository';
import { recordingClient, type RecordedQuery } from '../../test-support/supabase';

let recorded: RecordedQuery;

function makeRepo(): SupabaseSubscriberRepository {
  const fake = recordingClient();
  recorded = fake.recorded;
  return new SupabaseSubscriberRepository(fake.client);
}

describe('SupabaseSubscriberRepository.findActiveByPublisher', () => {
  it('queries the subscribers table filtered to the publisher and active status', async (): Promise<void> => {
    const repo = makeRepo();
    await repo.findActiveByPublisher('pub-1');
    expect(recorded.table).toBe('subscribers');
    expect(recorded.eqCalls).toContainEqual(['publisher_id', 'pub-1']);
    expect(recorded.eqCalls).toContainEqual(['status', 'active']);
  });

  it('maps returned rows to Subscriber entities', async (): Promise<void> => {
    const repo = makeRepo();
    recorded.result = {
      data: [{ id: 's1', publisher_id: 'pub-1', contact_handle: '+972500000001', status: 'active' }],
      error: null,
    };
    const subs = await repo.findActiveByPublisher('pub-1');
    expect(subs).toHaveLength(1);
    expect(subs[0]?.id).toBe('s1');
    expect(subs[0]?.contactHandle).toBe('+972500000001');
    expect(subs[0]?.isActive()).toBe(true);
  });

  it('returns an empty list when the query yields no rows (e.g. RLS blocked reads)', async (): Promise<void> => {
    const repo = makeRepo();
    recorded.result = { data: [], error: null };
    expect(await repo.findActiveByPublisher('pub-1')).toEqual([]);
  });

  it('throws when the query errors', async (): Promise<void> => {
    const repo = makeRepo();
    recorded.result = { data: null, error: { message: 'permission denied' } };
    await expect(repo.findActiveByPublisher('pub-1')).rejects.toThrow('permission denied');
  });
});
