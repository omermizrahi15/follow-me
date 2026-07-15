// Hits the real Supabase project. Two concerns, both gated on creds so the
// normal suite is never affected. Run locally with:
//   SUPABASE_SERVICE_ROLE_KEY=... npm run test:integration
//
// 1. Anon SELECT policy (20240006_subscribers_select_policy.sql): the app reads
//    subscribers with the ANON key, and without an anon SELECT policy RLS
//    returns zero rows even when subscribers exist (so the Followers list looked
//    empty). Seeding mirrors production — inserted with the SERVICE-ROLE key
//    (the join webhook's path, which bypasses RLS), read back through the anon
//    repository (the app's path).
//
// 2. findByContactHandle (added for STOP/START opt-out handling): returns every
//    subscription for a number and reflects status transitions. Written through
//    the service role, the same key the join-webhook edge function uses.

// Supabase Realtime requires WebSocket — stub it so the client can construct.
(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

import { createClient } from '@supabase/supabase-js';
import { SupabaseSubscriberRepository } from './SupabaseSubscriberRepository';
import { Subscriber } from '../../domain/entities/Subscriber';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined;
const anonKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] as string | undefined;
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] as string | undefined;
const RUN = supabaseUrl && anonKey && serviceKey;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

// Dedicated ids so the test never collides with real publisher data.
const PUBLISHER = 'integration-test-sub-publisher';
const OTHER_PUBLISHER = 'integration-test-sub-other';

describeIf(RUN)('SupabaseSubscriberRepository — anon SELECT policy (integration)', () => {
  // describe.skip still evaluates this body, and createClient throws on a
  // missing key — guard so absent creds skip the suite instead of failing it.
  const admin = RUN
    ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    : (null as never);

  async function clean(): Promise<void> {
    await admin.from('subscribers').delete().in('publisher_id', [PUBLISHER, OTHER_PUBLISHER]);
  }

  beforeAll(async (): Promise<void> => {
    await clean();
    // Service role bypasses RLS, exactly like the join webhook.
    const { error } = await admin.from('subscribers').insert([
      { publisher_id: PUBLISHER, contact_handle: '+10000000001', status: 'active' },
      { publisher_id: PUBLISHER, contact_handle: '+10000000002', status: 'revoked' },
      { publisher_id: OTHER_PUBLISHER, contact_handle: '+10000000003', status: 'active' },
    ]);
    if (error != null) throw new Error(`seed failed: ${error.message}`);
  });

  afterAll(async (): Promise<void> => {
    await clean();
  });

  function makeRepo(): SupabaseSubscriberRepository {
    return new SupabaseSubscriberRepository(supabaseUrl!, anonKey!);
  }

  it('the anon client can read a publisher\'s active subscribers (select policy)', async (): Promise<void> => {
    const subs = await makeRepo().findActiveByPublisher(PUBLISHER);
    expect(subs).toHaveLength(1);
    expect(subs[0]?.contactHandle).toBe('+10000000001');
    expect(subs[0]?.isActive()).toBe(true);
  });

  it('excludes revoked subscribers', async (): Promise<void> => {
    const subs = await makeRepo().findActiveByPublisher(PUBLISHER);
    expect(subs.map(s => s.contactHandle)).not.toContain('+10000000002');
  });

  it("does not return another publisher's subscribers", async (): Promise<void> => {
    const subs = await makeRepo().findActiveByPublisher(PUBLISHER);
    expect(subs.map(s => s.contactHandle)).not.toContain('+10000000003');
  });
});

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
