// Hits the real Supabase project with the ANON key — the same path the app
// uses when it tracks deliveries around a share (dev anon policies, like the
// other publisher-facing tables).
//
// Skipped automatically unless EXPO_PUBLIC_SUPABASE_URL and
// EXPO_PUBLIC_SUPABASE_ANON_KEY are set, so it never breaks the normal suite.
// Run locally with: npm run test:integration
//
// Verifies what unit tests can't: that notification_deliveries exists with the
// expected columns, the (photo_id, subscriber_id) upsert resets rows, and the
// status/attempt updates round-trip.

// Supabase Realtime requires WebSocket — stub it so the client can construct.
(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

import { createClient } from '@supabase/supabase-js';
import { SupabaseNotificationDeliveryRepository } from './SupabaseNotificationDeliveryRepository';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined;
const anonKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] as string | undefined;
const RUN = supabaseUrl && anonKey;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

// Dedicated markers so the test never collides with real delivery data.
const TEST_PUBLISHER = 'integration-test-deliveries';
const TEST_PHOTO = 'integration-test-photo-1';
const TEST_PHOTO_2 = 'integration-test-photo-2';
// subscriber_id is a uuid column — fixed valid uuids for the test rows.
const SUB_A = '00000000-0000-4000-8000-00000000000a';
const SUB_B = '00000000-0000-4000-8000-00000000000b';

describeIf(RUN)('SupabaseNotificationDeliveryRepository (integration)', () => {
  function makeRepo(): SupabaseNotificationDeliveryRepository {
    return new SupabaseNotificationDeliveryRepository(supabaseUrl!, anonKey!);
  }

  beforeEach(async (): Promise<void> => {
    const client = createClient(supabaseUrl!, anonKey!, { auth: { persistSession: false } });
    await client.from('notification_deliveries').delete().eq('publisher_id', TEST_PUBLISHER);
  });

  it('logs pending deliveries and reads them back per photo', async (): Promise<void> => {
    const repo = makeRepo();
    await repo.logPending([
      { photoId: TEST_PHOTO, subscriberId: SUB_A, publisherId: TEST_PUBLISHER },
      { photoId: TEST_PHOTO, subscriberId: SUB_B, publisherId: TEST_PUBLISHER },
      { photoId: TEST_PHOTO_2, subscriberId: SUB_A, publisherId: TEST_PUBLISHER },
    ]);

    const deliveries = await repo.findByPhoto(TEST_PHOTO);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every(d => d.status === 'pending')).toBe(true);
    expect(deliveries.every(d => d.attempts === 0)).toBe(true);
    expect(deliveries.every(d => d.lastAttemptedAt === null)).toBe(true);
  });

  it('tracks attempts and marks one subscriber sent, the other failed', async (): Promise<void> => {
    const repo = makeRepo();
    await repo.logPending([
      { photoId: TEST_PHOTO, subscriberId: SUB_A, publisherId: TEST_PUBLISHER },
      { photoId: TEST_PHOTO, subscriberId: SUB_B, publisherId: TEST_PUBLISHER },
    ]);

    await repo.recordAttempt([TEST_PHOTO], SUB_A, 1);
    await repo.markSent([TEST_PHOTO], SUB_A);
    await repo.recordAttempt([TEST_PHOTO], SUB_B, 4);
    await repo.markFailed([TEST_PHOTO], SUB_B);

    const byId = new Map((await repo.findByPhoto(TEST_PHOTO)).map(d => [d.subscriberId, d]));
    expect(byId.get(SUB_A)).toMatchObject({ status: 'sent', attempts: 1 });
    expect(byId.get(SUB_B)).toMatchObject({ status: 'failed', attempts: 4 });
    expect(byId.get(SUB_B)?.lastAttemptedAt).toBeTruthy();
  });

  it('re-sharing resets the (photo, subscriber) row to pending instead of duplicating', async (): Promise<void> => {
    const repo = makeRepo();
    await repo.logPending([{ photoId: TEST_PHOTO, subscriberId: SUB_A, publisherId: TEST_PUBLISHER }]);
    await repo.recordAttempt([TEST_PHOTO], SUB_A, 4);
    await repo.markFailed([TEST_PHOTO], SUB_A);

    await repo.logPending([{ photoId: TEST_PHOTO, subscriberId: SUB_A, publisherId: TEST_PUBLISHER }]);

    const deliveries = await repo.findByPhoto(TEST_PHOTO);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ status: 'pending', attempts: 0, lastAttemptedAt: null });
  });

  it('returns an empty array for an untracked photo', async (): Promise<void> => {
    const repo = makeRepo();
    expect(await repo.findByPhoto('integration-test-no-such-photo')).toEqual([]);
  });
});
