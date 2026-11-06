import { type AdminDb, cloudinaryIdsToDestroy, runAccountDeletion, USER_DATA_TABLES } from './accountDeletion';

const url = (id: string): string => `https://res.cloudinary.com/demo/image/upload/v1/${id}.jpg`;
const publicIdFromUrl = (u: string): string | null => u.match(/\/v1\/(.+)\.jpg$/)?.[1] ?? null;

describe('USER_DATA_TABLES', () => {
  it('covers every table that holds a user row, on the right column', () => {
    expect(Object.fromEntries(USER_DATA_TABLES.map((t) => [t.table, t.column]))).toEqual({
      posts: 'publisher_id',
      media: 'owner_id',
      candidate_photos: 'publisher_id',
      approval_batches: 'publisher_id',
      notification_deliveries: 'publisher_id',
      notification_log: 'publisher_id',
      message_logs: 'publisher_id',
      subscribers: 'publisher_id',
      publisher_config: 'publisher_id',
      publisher_profile: 'publisher_id',
      classify_quota: 'user_id',
      subscriptions: 'user_id',
    });
  });
});

describe('cloudinaryIdsToDestroy', () => {
  it('collects every asset the user owns, once each', () => {
    const ids = cloudinaryIdsToDestroy(
      {
        media: [{ url: url('a') }, { url: url('b') }],
        candidates: [{ url: url('a') }, { url: url('c') }],
        posts: [{ media_urls: [url('b'), url('d')] }],
        avatars: [{ avatar_url: url('avatar') }],
      },
      publicIdFromUrl,
    );
    expect(ids.sort()).toEqual(['a', 'avatar', 'b', 'c', 'd']);
  });

  it('ignores rows without a usable Cloudinary url', () => {
    expect(
      cloudinaryIdsToDestroy(
        {
          media: [{ url: 'ph://local-only' }],
          candidates: [],
          posts: [{ media_urls: null }, { media_urls: 'nope' }],
          avatars: [{ avatar_url: null }, { avatar_url: 'https://example.com/x.png' }],
        },
        publicIdFromUrl,
      ),
    ).toEqual([]);
  });
});

/** In-memory stand-in for the admin client; records what was deleted and in what order. */
function fakeDb(opts: { failDeleteOn?: string; failAuth?: boolean } = {}): { db: AdminDb; log: string[] } {
  const rows: Record<string, unknown[]> = {
    media: [{ url: url('m1') }],
    candidate_photos: [{ url: url('c1') }],
    posts: [{ media_urls: [url('p1')] }],
    publisher_profile: [{ avatar_url: url('av') }],
  };
  const log: string[] = [];
  const db: AdminDb = {
    from: (table) => ({
      select: () => ({ eq: () => Promise.resolve({ data: rows[table] ?? [], error: null }) }),
      delete: () => ({
        eq: () => {
          log.push(`delete:${table}`);
          return Promise.resolve({
            data: null,
            error: opts.failDeleteOn === table ? { message: 'boom' } : null,
          });
        },
      }),
    }),
    auth: {
      admin: {
        deleteUser: () => {
          log.push('deleteUser');
          return Promise.resolve({ error: opts.failAuth === true ? { message: 'auth boom' } : null });
        },
      },
    },
  };
  return { db, log };
}

describe('runAccountDeletion', () => {
  it('wipes every table, destroys the assets, and deletes the login last', async () => {
    const { db, log } = fakeDb();
    const destroyed: string[] = [];
    const result = await runAccountDeletion(db, 'u1', {
      publicIdFromUrl,
      destroyAsset: (id) => { destroyed.push(id); return Promise.resolve(true); },
    });

    expect(log).toEqual([...USER_DATA_TABLES.map((t) => `delete:${t.table}`), 'deleteUser']);
    expect(destroyed.sort()).toEqual(['av', 'c1', 'm1', 'p1']);
    expect(result).toEqual({ assetsFound: 4, assetsDeleted: 4 });
  });

  it('keeps the login when a table could not be wiped, so the user can retry', async () => {
    const { db, log } = fakeDb({ failDeleteOn: 'subscribers' });
    await expect(runAccountDeletion(db, 'u1', { publicIdFromUrl, destroyAsset: null })).rejects.toThrow('subscribers');
    expect(log).not.toContain('deleteUser');
  });

  it('is not undone by a Cloudinary failure', async () => {
    const { db, log } = fakeDb();
    const result = await runAccountDeletion(db, 'u1', {
      publicIdFromUrl,
      destroyAsset: () => Promise.reject(new Error('cloudinary down')),
    });
    expect(log.at(-1)).toBe('deleteUser');
    expect(result).toEqual({ assetsFound: 4, assetsDeleted: 0 });
  });

  it('works without Cloudinary credentials', async () => {
    const { db } = fakeDb();
    await expect(runAccountDeletion(db, 'u1', { publicIdFromUrl, destroyAsset: null })).resolves.toEqual({
      assetsFound: 4,
      assetsDeleted: 0,
    });
  });

  it('reports a failed login deletion', async () => {
    const { db } = fakeDb({ failAuth: true });
    await expect(runAccountDeletion(db, 'u1', { publicIdFromUrl, destroyAsset: null })).rejects.toThrow('auth boom');
  });
});
