// Hits the real Supabase project with the SERVICE-ROLE key — the same path the
// join-webhook edge function uses to write the audit log (notification_log has
// RLS enabled with no anon policy, so the service role is the only writer).
//
// Skipped automatically unless EXPO_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are set, so it never breaks the normal suite.
// Run locally with: SUPABASE_SERVICE_ROLE_KEY=… npm run test:integration
//
// Verifies what unit tests can't: that the notification_log table exists with
// the expected columns and that record()/findByContact() round-trip.

// Supabase Realtime requires WebSocket — stub it so the client can construct.
(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

import { createClient } from '@supabase/supabase-js';
import { SupabaseNotificationLogRepository } from './SupabaseNotificationLogRepository';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined;
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] as string | undefined;
const RUN = supabaseUrl && serviceKey;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

// A dedicated contact handle so the test never collides with real audit data.
const TEST_CONTACT = '+19998887766';
const TEST_PUBLISHER = 'integration-test-publisher';

describeIf(RUN)('SupabaseNotificationLogRepository (integration)', () => {
  function makeRepo(): SupabaseNotificationLogRepository {
    return new SupabaseNotificationLogRepository(
      createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } }),
    );
  }

  // Append-only table: clear the test rows before each run so counts are exact.
  beforeEach(async (): Promise<void> => {
    const client = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } });
    await client.from('notification_log').delete().eq('contact_handle', TEST_CONTACT);
  });

  it('records an opt_out event and reads it back', async (): Promise<void> => {
    const repo = makeRepo();
    await repo.record({
      subscriberId: null,
      publisherId: TEST_PUBLISHER,
      contactHandle: TEST_CONTACT,
      event: 'opt_out',
      detail: 'STOP',
    });

    const entries = await repo.findByContact(TEST_CONTACT);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      publisherId: TEST_PUBLISHER,
      contactHandle: TEST_CONTACT,
      event: 'opt_out',
      detail: 'STOP',
    });
    expect(entries[0]?.id).toBeTruthy();
    expect(entries[0]?.createdAt).toBeTruthy();
  });

  it('returns events for a contact in chronological order', async (): Promise<void> => {
    const repo = makeRepo();
    await repo.record({
      subscriberId: null,
      publisherId: TEST_PUBLISHER,
      contactHandle: TEST_CONTACT,
      event: 'opt_out',
    });
    await repo.record({
      subscriberId: null,
      publisherId: TEST_PUBLISHER,
      contactHandle: TEST_CONTACT,
      event: 'opt_in',
    });

    const entries = await repo.findByContact(TEST_CONTACT);
    expect(entries.map(e => e.event)).toEqual(['opt_out', 'opt_in']);
  });

  it('returns an empty array for a contact with no events', async (): Promise<void> => {
    const repo = makeRepo();
    const entries = await repo.findByContact('+10000000001');
    expect(entries).toEqual([]);
  });
});
