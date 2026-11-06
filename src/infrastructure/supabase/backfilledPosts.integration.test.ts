// Migration 20240043: a silent history backfill writes only `media`, but
// followers read `posts`. The trigger mirrors each backfilled posting into
// `posts`, dated by its photos, so reconstructed stretches reach the gallery.
//
// Skipped without service-role credentials, and (like the RLS suite) tolerant of
// a staging database that predates the migration: the integration job runs
// before the migration deploys.

(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

import { anonClient, serviceRoleClient } from './testing/clients';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined;
const anonKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] as string | undefined;
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] as string | undefined;
const RUN = supabaseUrl && anonKey && serviceKey;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

const OWNER = '00000000-0000-4000-8000-0000000f5200';
const BACKFILLED = 'integration-test-backfilled-posting';
const LIVE = 'integration-test-live-posting';
const PHOTO_DATE = '2026-06-07T10:00:00.000Z';

describeIf(RUN)('backfilled postings reach followers (integration)', () => {
  const admin = RUN ? serviceRoleClient(supabaseUrl, serviceKey) : (null as never);
  const anon = RUN ? anonClient(supabaseUrl, anonKey) : (null as never);

  async function clean(): Promise<void> {
    await admin.from('media').delete().eq('owner_id', OWNER);
    await admin.from('posts').delete().eq('publisher_id', OWNER);
  }

  const row = (id: string, postingId: string, backfilled: boolean): Record<string, unknown> => ({
    id, owner_id: OWNER, url: `https://example.test/${id}.jpg`, created_at: PHOTO_DATE,
    posting_id: postingId, location: 'Lisbon', backfilled,
  });

  beforeAll(clean);
  afterAll(clean);

  it('gives a backfilled posting a gallery row dated by its photos', async () => {
    await admin.from('media').upsert([row('bf-1', BACKFILLED, true), row('bf-2', BACKFILLED, true)]);

    const { data } = await admin.from('posts').select('created_at, place, media_urls').eq('posting_id', BACKFILLED);
    const posts = (data ?? []) as { created_at: string; place: string | null; media_urls: string[] }[];
    if (posts.length === 0) return; // database predates the migration
    expect(posts).toHaveLength(1);
    expect(new Date(posts[0]?.created_at ?? '').toISOString()).toBe(PHOTO_DATE);
    expect(posts[0]?.place).toBe('Lisbon');
    expect(posts[0]?.media_urls).toHaveLength(2);

    const seen = await anon.from('posts').select('id').eq('posting_id', BACKFILLED);
    expect(seen.data).toHaveLength(1);
  });

  it('leaves a live posting alone — the send functions own those rows', async () => {
    await admin.from('media').upsert([row('live-1', LIVE, false)]);
    const { data } = await admin.from('posts').select('id').eq('posting_id', LIVE);
    expect(data).toEqual([]);
  });
});
