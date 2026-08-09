// Hits the real Supabase project. Two concerns, both gated on creds so the
// normal suite is never affected. Run locally with:
//   SUPABASE_SERVICE_ROLE_KEY=... AUTH_TEST_PHONE=... AUTH_TEST_OTP=... \
//     npm run test:integration
//
// 1. Owner-only SELECT (20240031_rls_owner_only_policies.sql): the app reads
//    subscribers with the SIGNED-IN user's client, and the policy matches
//    `auth.uid() = publisher_id`, so a publisher sees their own rows and
//    nobody else's. Seeding mirrors production — inserted with the
//    SERVICE-ROLE key (the join webhook's path, which bypasses RLS), read back
//    through the authenticated repository (the app's path). Before 20240031
//    this table was readable by anyone holding the bundled anon key, which is
//    what `rls.integration.test.ts` now guards against.
//
// 2. findByContactHandle (added for STOP/START opt-out handling): returns every
//    subscription for a number and reflects status transitions. Written through
//    the service role, the same key the join-webhook edge function uses — it
//    spans publishers by design, so no owner policy could allow it.

// Supabase Realtime requires WebSocket — stub it so the client can construct.
(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

import type { AppSupabaseClient } from '../supabase/types';
import { SupabaseSubscriberRepository } from './SupabaseSubscriberRepository';
import { Subscriber } from '../../domain/entities/Subscriber';
import { serviceRoleClient, signedInClient } from '../supabase/testing/clients';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined;
const anonKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] as string | undefined;
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] as string | undefined;
const testPhone = process.env['AUTH_TEST_PHONE'] as string | undefined;
const testOtp = process.env['AUTH_TEST_OTP'] as string | undefined;
const RUN = supabaseUrl && anonKey && serviceKey && testPhone && testOtp;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

// A dedicated id so the test never collides with real publisher data. The
// publisher under test is the signed-in user, whose id RLS pins us to.
const OTHER_PUBLISHER = 'integration-test-sub-other';

describeIf(RUN)('SupabaseSubscriberRepository — owner-only SELECT policy (integration)', () => {
  // describe.skip still evaluates this body, and createClient throws on a
  // missing key — guard so absent creds skip the suite instead of failing it.
  const admin = RUN ? serviceRoleClient(supabaseUrl, serviceKey) : (null as never);
  let client: AppSupabaseClient;
  let publisher: string;

  async function clean(): Promise<void> {
    await admin.from('subscribers').delete().in('publisher_id', [publisher, OTHER_PUBLISHER]);
  }

  beforeAll(async (): Promise<void> => {
    ({ client, userId: publisher } = await signedInClient(
      supabaseUrl!, anonKey!, testPhone!, testOtp!,
    ));
    await clean();
    // Service role bypasses RLS, exactly like the join webhook.
    const { error } = await admin.from('subscribers').insert([
      { publisher_id: publisher, contact_handle: '+10000000001', status: 'active' },
      { publisher_id: publisher, contact_handle: '+10000000002', status: 'revoked' },
      { publisher_id: OTHER_PUBLISHER, contact_handle: '+10000000003', status: 'active' },
    ]);
    if (error != null) throw new Error(`seed failed: ${error.message}`);
  });

  afterAll(async (): Promise<void> => {
    await clean();
    await client.auth.signOut();
  });

  function makeRepo(): SupabaseSubscriberRepository {
    return new SupabaseSubscriberRepository(client);
  }

  it("the signed-in publisher can read their own active subscribers", async (): Promise<void> => {
    const subs = await makeRepo().findActiveByPublisher(publisher);
    expect(subs).toHaveLength(1);
    expect(subs[0]?.contactHandle).toBe('+10000000001');
    expect(subs[0]?.isActive()).toBe(true);
  });

  it('excludes revoked subscribers', async (): Promise<void> => {
    const subs = await makeRepo().findActiveByPublisher(publisher);
    expect(subs.map(s => s.contactHandle)).not.toContain('+10000000002');
  });

  it("does not return another publisher's subscribers", async (): Promise<void> => {
    // Asking for them outright: the policy, not the query's filter, is what
    // makes this empty — the repository happily builds the request.
    const subs = await makeRepo().findActiveByPublisher(OTHER_PUBLISHER);
    expect(subs).toEqual([]);
  });
});

const TEST_CONTACT = '+19998887755';
const PUB_A = 'integration-test-pub-a';
const PUB_B = 'integration-test-pub-b';
const ID_A = '00000000-0000-4000-8000-0000000015a1';
const ID_B = '00000000-0000-4000-8000-0000000015b2';

describeIf(RUN)('SupabaseSubscriberRepository.findByContactHandle (integration)', () => {
  const admin = RUN ? serviceRoleClient(supabaseUrl, serviceKey) : (null as never);

  function makeRepo(): SupabaseSubscriberRepository {
    return new SupabaseSubscriberRepository(admin);
  }

  beforeEach(async (): Promise<void> => {
    await admin.from('subscribers').delete().eq('contact_handle', TEST_CONTACT);
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
