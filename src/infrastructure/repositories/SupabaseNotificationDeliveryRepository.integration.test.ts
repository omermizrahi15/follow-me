// Hits the real Supabase project as a SIGNED-IN user — the same path the app
// uses when it tracks deliveries around a share. The owner-only policy from
// 20240031 matches `auth.uid() = publisher_id`, so the rows are keyed on the
// test user's id rather than a made-up publisher string.
//
// Skipped automatically unless the creds are set, so it never breaks the
// normal suite. Run locally with:
//   AUTH_TEST_PHONE=... AUTH_TEST_OTP=... npm run test:integration
//
// Verifies what unit tests can't: that notification_deliveries exists with the
// expected columns, the (photo_id, subscriber_id) upsert resets rows, and the
// status/attempt updates round-trip.

// Supabase Realtime requires WebSocket — stub it so the client can construct.
(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

import type { AppSupabaseClient } from '../supabase/types';
import { SupabaseNotificationDeliveryRepository } from './SupabaseNotificationDeliveryRepository';
import { signedInClient } from '../supabase/testing/clients';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined;
const anonKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] as string | undefined;
const testPhone = process.env['AUTH_TEST_PHONE'] as string | undefined;
const testOtp = process.env['AUTH_TEST_OTP'] as string | undefined;
const RUN = supabaseUrl && anonKey && testPhone && testOtp;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

// Dedicated markers so the test never collides with real delivery data.
const TEST_PHOTO = 'integration-test-photo-1';
const TEST_PHOTO_2 = 'integration-test-photo-2';
// subscriber_id is a uuid column — fixed valid uuids for the test rows.
const SUB_A = '00000000-0000-4000-8000-00000000000a';
const SUB_B = '00000000-0000-4000-8000-00000000000b';

describeIf(RUN)('SupabaseNotificationDeliveryRepository (integration)', () => {
  let client: AppSupabaseClient;
  // The publisher IS the signed-in user — RLS admits no other value.
  let TEST_PUBLISHER: string;

  function makeRepo(): SupabaseNotificationDeliveryRepository {
    return new SupabaseNotificationDeliveryRepository(client);
  }

  beforeAll(async (): Promise<void> => {
    ({ client, userId: TEST_PUBLISHER } = await signedInClient(
      supabaseUrl!, anonKey!, testPhone!, testOtp!,
    ));
  });

  afterAll(async (): Promise<void> => {
    await client.from('notification_deliveries').delete().eq('publisher_id', TEST_PUBLISHER);
    await client.auth.signOut();
  });

  beforeEach(async (): Promise<void> => {
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

  it('leaves a single pending row when two clients re-share the same pair at once', async (): Promise<void> => {
    const repo = makeRepo();
    const delivery = { photoId: TEST_PHOTO, subscriberId: SUB_A, publisherId: TEST_PUBLISHER };
    // Two concurrent shares race on the (photo, subscriber) upsert; the unique
    // index must collapse them to one row rather than raising or duplicating.
    await Promise.all([repo.logPending([delivery]), repo.logPending([delivery])]);

    const deliveries = await repo.findByPhoto(TEST_PHOTO);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ status: 'pending', attempts: 0, lastAttemptedAt: null });
  });

  it('returns an empty array for an untracked photo', async (): Promise<void> => {
    const repo = makeRepo();
    expect(await repo.findByPhoto('integration-test-no-such-photo')).toEqual([]);
  });
});
