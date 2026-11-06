// Account deletion core (issue #253). Runs in the delete-account Edge Function
// (Deno) and in the staging integration test (Node), so it imports nothing and
// takes the Supabase admin client and the Cloudinary helpers as arguments — see
// CONTRIBUTING.md → "Code that runs in both runtimes".

/**
 * Every table with per-user rows and the column that ties a row to the user.
 *
 * A new table that stores user data must be added here — the unit test pins the
 * list, and the integration test seeds each entry and checks it is emptied.
 * Global tables (provider_limits, provider_health) hold no user data.
 */
export const USER_DATA_TABLES: readonly { table: string; column: string }[] = [
  { table: 'posts', column: 'publisher_id' },
  { table: 'media', column: 'owner_id' },
  { table: 'candidate_photos', column: 'publisher_id' },
  { table: 'approval_batches', column: 'publisher_id' },
  { table: 'notification_deliveries', column: 'publisher_id' },
  { table: 'notification_log', column: 'publisher_id' },
  { table: 'message_logs', column: 'publisher_id' },
  { table: 'subscribers', column: 'publisher_id' },
  { table: 'publisher_config', column: 'publisher_id' },
  { table: 'publisher_profile', column: 'publisher_id' },
  { table: 'classify_quota', column: 'user_id' },
  // Paid-plan record (issue #252). Deleting the account does not cancel the store
  // subscription — that is Apple's, and the user ends it in their Apple ID settings.
  { table: 'subscriptions', column: 'user_id' },
];

interface DbResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

/** The slice of the Supabase admin client this module uses. */
export interface AdminDb {
  from(table: string): {
    select(columns: string): { eq(column: string, value: string): PromiseLike<DbResult> };
    delete(): { eq(column: string, value: string): PromiseLike<DbResult> };
  };
  auth: { admin: { deleteUser(id: string): PromiseLike<{ error: { message: string } | null }> } };
}

export interface AccountDeletionDeps {
  /** Public id for a Cloudinary delivery URL, null when it is not one. */
  publicIdFromUrl: (url: string) => string | null;
  /** Destroys one Cloudinary asset; true when it is gone. Absent = no Cloudinary credentials. */
  destroyAsset: ((publicId: string) => Promise<boolean>) | null;
}

export interface AccountDeletionResult {
  assetsFound: number;
  assetsDeleted: number;
}

/** Cloudinary public ids behind everything the user uploaded, deduplicated. */
export function cloudinaryIdsToDestroy(
  rows: { media: unknown[]; candidates: unknown[]; posts: unknown[]; avatars: unknown[] },
  publicIdFromUrl: (url: string) => string | null,
): string[] {
  const field = (r: unknown, key: string): unknown => (r as Record<string, unknown> | null)?.[key];
  const candidates: unknown[] = [
    ...rows.media.map((r) => field(r, 'url')),
    ...rows.candidates.map((r) => field(r, 'url')),
    ...rows.avatars.map((r) => field(r, 'avatar_url')),
    ...rows.posts.flatMap((r) => {
      const urls = field(r, 'media_urls');
      return Array.isArray(urls) ? (urls as unknown[]) : [];
    }),
  ];
  const ids = new Set<string>();
  for (const u of candidates) {
    if (typeof u !== 'string') continue;
    const id = publicIdFromUrl(u);
    if (id != null) ids.add(id);
  }
  return [...ids];
}

/**
 * Deletes one user's data, their Cloudinary assets and finally the login.
 *
 * Order matters for retries: asset ids are read first (the rows that name them
 * are about to go), rows are wiped, assets destroyed best-effort, and the auth
 * user goes LAST — if anything earlier throws the user still exists and can run
 * it again. Every step is idempotent. Throws on a database failure.
 */
export async function runAccountDeletion(
  db: AdminDb,
  userId: string,
  deps: AccountDeletionDeps,
): Promise<AccountDeletionResult> {
  const read = async (table: string, columns: string, owner: string): Promise<unknown[]> => {
    const { data, error } = await db.from(table).select(columns).eq(owner, userId);
    if (error != null) throw new Error(`${table}: ${error.message}`);
    return data ?? [];
  };
  const assetIds = cloudinaryIdsToDestroy(
    {
      media: await read('media', 'url', 'owner_id'),
      candidates: await read('candidate_photos', 'url', 'publisher_id'),
      posts: await read('posts', 'media_urls', 'publisher_id'),
      avatars: await read('publisher_profile', 'avatar_url', 'publisher_id'),
    },
    deps.publicIdFromUrl,
  );

  for (const { table, column } of USER_DATA_TABLES) {
    const { error } = await db.from(table).delete().eq(column, userId);
    if (error != null) throw new Error(`${table}: ${error.message}`);
  }

  let assetsDeleted = 0;
  if (deps.destroyAsset != null) {
    for (const id of assetIds) {
      try {
        if (await deps.destroyAsset(id)) assetsDeleted++;
      } catch {
        // Best-effort: the rows are already gone, an orphaned asset is not a failed deletion.
      }
    }
  }

  const { error: authError } = await db.auth.admin.deleteUser(userId);
  if (authError != null) throw new Error(`auth: ${authError.message}`);

  return { assetsFound: assetIds.length, assetsDeleted };
}
