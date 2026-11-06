// Proves account deletion against the real staging database (issue #253): a
// throwaway user gets a row in EVERY user table, `runAccountDeletion` runs with
// the service role exactly as the delete-account Edge Function runs it, and
// nothing may be left — no rows, no login. The unit tests use a fake client;
// this is the one that catches a table or column the real schema disagrees on.
//
// Needs only the service role (it makes its own user, no test OTP):
//   EXPO_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:integration

(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

import { randomUUID } from 'crypto';
import { publicIdFromUrl } from '../../../supabase/functions/delete-candidates/logic';
import { serviceRoleClient } from '../supabase/testing/clients';
import { type AdminDb, runAccountDeletion, USER_DATA_TABLES } from './accountDeletion';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined;
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] as string | undefined;
const RUN = supabaseUrl && serviceKey;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);
const asset = (id: string): string => `https://res.cloudinary.com/demo/image/upload/v1/it-delete/${id}.jpg`;

describeIf(RUN)('account deletion (integration)', () => {
  // Dozens of sequential round trips to staging (seed 11 tables, delete, verify
  // 11 tables) — well past jest's 5s default, and slower still on a cold runner.
  jest.setTimeout(60_000);

  const admin = RUN ? serviceRoleClient(supabaseUrl, serviceKey) : (null as never);
  let userId: string;

  beforeAll(async (): Promise<void> => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `it-delete-${randomUUID()}@example.test`,
      email_confirm: true,
    });
    if (error != null) throw new Error(`could not create test user: ${error.message}`);
    userId = data.user.id;

    const seeds: [string, Record<string, unknown>][] = [
      ['media', { id: `it-${userId}`, owner_id: userId, url: asset('media') }],
      ['candidate_photos', { publisher_id: userId, asset_id: `it-${userId}`, url: asset('cand'), created_at: new Date(0).toISOString() }],
      ['posts', { id: `it-${userId}`.slice(0, 20), publisher_id: userId, media_urls: [asset('post')], posting_id: `it-${userId}` }],
      ['approval_batches', { batch_id: `it-${userId}`, publisher_id: userId, batch: [], pool: [] }],
      ['notification_deliveries', { photo_id: `it-${userId}`, subscriber_id: randomUUID(), publisher_id: userId, status: 'pending' }],
      ['notification_log', { publisher_id: userId, contact_handle: '+10000008888', event: 'opt_out' }],
      ['message_logs', { message_sid: `it-${userId}`, publisher_id: userId, contact_handle: '+10000008888' }],
      ['subscribers', { id: randomUUID(), publisher_id: userId, contact_handle: '+10000008888', status: 'active' }],
      ['publisher_config', { publisher_id: userId, frequency: 'weekly', photos_per_post: 5 }],
      ['publisher_profile', { publisher_id: userId, display_name: 'IT Delete', avatar_url: asset('avatar') }],
      ['classify_quota', { user_id: userId, day: '2000-01-01', count: 1 }],
    ];
    expect(seeds.map(([t]) => t).sort()).toEqual(USER_DATA_TABLES.map((t) => t.table).sort());
    for (const [table, row] of seeds) {
      const { error: seedError } = await admin.from(table).insert(row);
      if (seedError != null) throw new Error(`seed of ${table} failed: ${seedError.message}`);
    }
  });

  afterAll(async (): Promise<void> => {
    // Only reached with rows left over if the test itself failed.
    for (const { table, column } of USER_DATA_TABLES) await admin.from(table).delete().eq(column, userId);
    await admin.auth.admin.deleteUser(userId);
  });

  it('removes every row, every asset, and the login', async (): Promise<void> => {
    const destroyed: string[] = [];
    const result = await runAccountDeletion(admin as unknown as AdminDb, userId, {
      publicIdFromUrl,
      destroyAsset: (id) => { destroyed.push(id); return Promise.resolve(true); },
    });

    expect(destroyed.sort()).toEqual(['it-delete/avatar', 'it-delete/cand', 'it-delete/media', 'it-delete/post']);
    expect(result).toEqual({ assetsFound: 4, assetsDeleted: 4 });

    for (const { table, column } of USER_DATA_TABLES) {
      const { data, error } = await admin.from(table).select(column).eq(column, userId);
      expect(error).toBeNull();
      expect({ table, left: data }).toEqual({ table, left: [] });
    }
    const { data: gone } = await admin.auth.admin.getUserById(userId);
    expect(gone.user).toBeNull();
  });
});
