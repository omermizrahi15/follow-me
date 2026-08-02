// The negative test for migration 20240031 (issue #9): proves the bundled anon
// key is no longer a master key.
//
// `EXPO_PUBLIC_SUPABASE_ANON_KEY` is compiled into the app bundle and is
// trivially extractable, so "what can a bare anon client do?" is the actual
// security boundary. Before 20240031 the answer was: read every publisher's
// photos, read every follower's phone number, rewrite anyone's posting config
// and delete anyone's uploads. Each expectation below is one of those.
//
// Seeding goes through the service role (an Edge Function's path, which
// bypasses RLS) so there are real rows present — an empty read has to mean
// "the policy hid them", not "the table was empty".
//
// Run locally with:
//   SUPABASE_SERVICE_ROLE_KEY=... AUTH_TEST_PHONE=... AUTH_TEST_OTP=... \
//     npm run test:integration

// Supabase Realtime requires WebSocket — stub it so the client can construct.
(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

import type { AppSupabaseClient } from './types';
import { anonClient, serviceRoleClient, signedInClient } from './testing/clients';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined;
const anonKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] as string | undefined;
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] as string | undefined;
const testPhone = process.env['AUTH_TEST_PHONE'] as string | undefined;
const testOtp = process.env['AUTH_TEST_OTP'] as string | undefined;
const RUN = supabaseUrl && anonKey && serviceKey && testPhone && testOtp;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

// A publisher nobody is signed in as: the "other user" whose data must stay
// invisible both to anon and to the signed-in test user.
const VICTIM = 'integration-test-rls-victim';
const PHOTO_ID = 'integration-test-rls-photo';
const BATCH_ID = 'integration-test-rls-batch';
const SUB_ID = '00000000-0000-4000-8000-0000000f5100';

describeIf(RUN)('RLS — the bundled anon key (integration)', () => {
  // describe.skip still evaluates this body, and createClient throws on a
  // missing key — guard so absent creds skip the suite instead of failing it.
  const admin = RUN ? serviceRoleClient(supabaseUrl, serviceKey) : (null as never);
  const anon = RUN ? anonClient(supabaseUrl, anonKey) : (null as never);
  let authed: AppSupabaseClient;

  async function clean(): Promise<void> {
    await admin.from('media').delete().eq('owner_id', VICTIM);
    await admin.from('candidate_photos').delete().eq('publisher_id', VICTIM);
    await admin.from('publisher_config').delete().eq('publisher_id', VICTIM);
    await admin.from('publisher_profile').delete().eq('publisher_id', VICTIM);
    await admin.from('subscribers').delete().eq('publisher_id', VICTIM);
    await admin.from('approval_batches').delete().eq('publisher_id', VICTIM);
    await admin.from('notification_deliveries').delete().eq('publisher_id', VICTIM);
  }

  beforeAll(async (): Promise<void> => {
    ({ client: authed } = await signedInClient(supabaseUrl!, anonKey!, testPhone!, testOtp!));
    await clean();
    const seeds: [string, Record<string, unknown>][] = [
      ['media', { id: PHOTO_ID, owner_id: VICTIM, url: 'https://cdn.example/x.jpg' }],
      ['candidate_photos', {
        publisher_id: VICTIM, asset_id: PHOTO_ID, url: 'https://cdn.example/x.jpg',
        created_at: new Date(0).toISOString(),
      }],
      ['publisher_config', { publisher_id: VICTIM, frequency: 'weekly', photos_per_post: 5 }],
      ['publisher_profile', { publisher_id: VICTIM, display_name: 'RLS Victim' }],
      ['subscribers', { id: SUB_ID, publisher_id: VICTIM, contact_handle: '+10000009999', status: 'active' }],
      ['approval_batches', { batch_id: BATCH_ID, publisher_id: VICTIM, batch: [], pool: [] }],
      ['notification_deliveries', {
        photo_id: PHOTO_ID, subscriber_id: SUB_ID, publisher_id: VICTIM, status: 'pending',
      }],
    ];
    for (const [table, row] of seeds) {
      const { error } = await admin.from(table).insert(row);
      if (error != null) throw new Error(`seed of ${table} failed: ${error.message}`);
    }
  });

  afterAll(async (): Promise<void> => {
    await clean();
    await authed.auth.signOut();
  });

  // Every table whose rows belong to one publisher and nobody else.
  const OWNED_TABLES = [
    ['media', 'owner_id'],
    ['candidate_photos', 'publisher_id'],
    ['publisher_config', 'publisher_id'],
    ['subscribers', 'publisher_id'],
    ['approval_batches', 'publisher_id'],
    ['notification_deliveries', 'publisher_id'],
  ] as const;

  it.each(OWNED_TABLES)('anon reads 0 rows from %s (rows exist)', async (table, column): Promise<void> => {
    // The row is really there — the service role can see it.
    const seen = await admin.from(table).select(column).eq(column, VICTIM);
    expect(seen.data).toHaveLength(1);

    const { data, error } = await anon.from(table).select(column).eq(column, VICTIM);
    // Postgres hides the rows rather than raising: 0 rows, not an error. The
    // AC calls this out explicitly — an error would leak that the row exists.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it.each(OWNED_TABLES)('a signed-in publisher reads 0 rows of someone else\'s %s', async (table, column): Promise<void> => {
    const { data, error } = await authed.from(table).select(column).eq(column, VICTIM);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('anon cannot rewrite a publisher\'s posting config', async (): Promise<void> => {
    const { error } = await anon
      .from('publisher_config')
      .update({ photos_per_post: 1 })
      .eq('publisher_id', VICTIM);
    // An UPDATE with no visible rows is a silent no-op, so assert on the data.
    expect(error).toBeNull();
    const { data } = await admin
      .from('publisher_config').select('photos_per_post').eq('publisher_id', VICTIM).single();
    expect(data?.photos_per_post).toBe(5);
  });

  it('anon cannot delete a publisher\'s uploaded photos', async (): Promise<void> => {
    await anon.from('candidate_photos').delete().eq('publisher_id', VICTIM);
    const { data } = await admin.from('candidate_photos').select('asset_id').eq('publisher_id', VICTIM);
    expect(data).toHaveLength(1);
  });

  it('anon cannot insert rows attributed to someone else', async (): Promise<void> => {
    const { error } = await anon.from('candidate_photos').insert({
      publisher_id: VICTIM,
      asset_id: 'forged',
      url: 'https://cdn.example/forged.jpg',
      created_at: new Date(0).toISOString(),
    });
    expect(error).not.toBeNull();
  });

  it('anon cannot read follower phone numbers — the worst of it', async (): Promise<void> => {
    const { data } = await anon.from('subscribers').select('contact_handle');
    // No filter at all: this is the "dump the table" query.
    expect(data).toEqual([]);
  });

  // Two deliberate exceptions — the public gallery link is unauthenticated.
  describe('public gallery reads still work', () => {
    it('anon can read a publisher_profile name and avatar', async (): Promise<void> => {
      const { data, error } = await anon
        .from('publisher_profile')
        .select('display_name, avatar_url')
        .eq('publisher_id', VICTIM);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.display_name).toBe('RLS Victim');
    });

    it('anon still cannot rename someone else\'s profile', async (): Promise<void> => {
      await anon.from('publisher_profile').update({ display_name: 'hacked' }).eq('publisher_id', VICTIM);
      const { data } = await admin
        .from('publisher_profile').select('display_name').eq('publisher_id', VICTIM).single();
      expect(data?.display_name).toBe('RLS Victim');
    });

    it('anon can select from posts (the gallery feed)', async (): Promise<void> => {
      const { error } = await anon.from('posts').select('id').limit(1);
      expect(error).toBeNull();
    });

    it('anon cannot write to posts', async (): Promise<void> => {
      const { error } = await anon.from('posts').insert({
        id: 'integration-test-rls-post',
        publisher_id: '00000000-0000-4000-8000-0000000f5101',
        media_urls: [],
      });
      expect(error).not.toBeNull();
    });
  });
});
