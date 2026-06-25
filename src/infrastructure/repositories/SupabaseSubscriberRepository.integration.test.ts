// Hits the real Supabase project. Verifies the bug this fixes: the app reads
// subscribers with the ANON key, and without an anon SELECT policy on the
// subscribers table, RLS returns zero rows even when subscribers exist (so the
// Followers list looked empty). See 20240006_subscribers_select_policy.sql.
//
// Seeding mirrors production: rows are inserted with the SERVICE-ROLE key (the
// join webhook's path, which bypasses RLS), then read back through the anon
// repository (the app's path). Requires both keys; skipped otherwise, so it
// never breaks the normal suite. Run locally with:
//   SUPABASE_SERVICE_ROLE_KEY=... npm run test:integration

// Supabase Realtime requires WebSocket — stub it so the client can construct.
(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

import { createClient } from '@supabase/supabase-js';
import { SupabaseSubscriberRepository } from './SupabaseSubscriberRepository';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined;
const anonKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] as string | undefined;
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] as string | undefined;
const RUN = supabaseUrl && anonKey && serviceKey;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

// Dedicated ids so the test never collides with real publisher data.
const PUBLISHER = 'integration-test-sub-publisher';
const OTHER_PUBLISHER = 'integration-test-sub-other';

describeIf(RUN)('SupabaseSubscriberRepository (integration)', () => {
  const admin = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } });

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
