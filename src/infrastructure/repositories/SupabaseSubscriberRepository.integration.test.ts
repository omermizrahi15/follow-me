// Hits the real Supabase project with the SERVICE-ROLE key — subscribers has
// RLS enabled with no anon write policy, so writes go through the service role
// (the same key the join-webhook edge function uses). Skipped automatically
// unless EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
// Run locally with: SUPABASE_SERVICE_ROLE_KEY=… npm run test:integration
//
// Verifies findByContactHandle (added for STOP/START opt-out handling): that it
// returns every subscription for a number and reflects status transitions.

// Supabase Realtime requires WebSocket — stub it so the client can construct.
(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

import { createClient } from '@supabase/supabase-js';
import { SupabaseSubscriberRepository } from './SupabaseSubscriberRepository';
import { Subscriber } from '../../domain/entities/Subscriber';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined;
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] as string | undefined;
const RUN = supabaseUrl && serviceKey;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

const TEST_CONTACT = '+19998887755';
const PUB_A = 'integration-test-pub-a';
const PUB_B = 'integration-test-pub-b';
const ID_A = '00000000-0000-4000-8000-0000000015a1';
const ID_B = '00000000-0000-4000-8000-0000000015b2';

describeIf(RUN)('SupabaseSubscriberRepository.findByContactHandle (integration)', () => {
  function makeRepo(): SupabaseSubscriberRepository {
    return new SupabaseSubscriberRepository(supabaseUrl!, serviceKey!);
  }

  beforeEach(async (): Promise<void> => {
    const client = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } });
    await client.from('subscribers').delete().eq('contact_handle', TEST_CONTACT);
  });

  it('returns every subscription tied to a number, across publishers', async (): Promise<void> => {
    const repo = makeRepo();
    await repo.save(Subscriber.create({ id: ID_A, publisherId: PUB_A, contactHandle: TEST_CONTACT, status: 'active' }));
    await repo.save(Subscriber.create({ id: ID_B, publisherId: PUB_B, contactHandle: TEST_CONTACT, status: 'active' }));

    const found = await repo.findByContactHandle(TEST_CONTACT);
    expect(found).toHaveLength(2);
    expect(found.map(s => s.publisherId).sort()).toEqual([PUB_A, PUB_B]);
  });

  it('reflects a status transition (active → revoked) after save', async (): Promise<void> => {
    const repo = makeRepo();
    const sub = Subscriber.create({ id: ID_A, publisherId: PUB_A, contactHandle: TEST_CONTACT, status: 'active' });
    await repo.save(sub);

    await repo.save(sub.revoke());

    const found = await repo.findByContactHandle(TEST_CONTACT);
    expect(found).toHaveLength(1);
    expect(found[0]?.status).toBe('revoked');
  });

  it('returns an empty array for a number with no subscriptions', async (): Promise<void> => {
    const repo = makeRepo();
    const found = await repo.findByContactHandle('+10000000002');
    expect(found).toEqual([]);
  });
});
