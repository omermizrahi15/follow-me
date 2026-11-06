// Pure helpers for delete-account, split out of index.ts for unit testing:
// which tables hold a user's rows, and which Cloudinary assets belong to them.

import { publicIdFromUrl } from '../delete-candidates/logic.ts';

/**
 * Every table with per-user rows and the column that ties a row to the user.
 *
 * Adding a table that stores user data means adding it here — the test pins the
 * list so that cannot be forgotten silently. Global tables (provider_limits,
 * provider_health) hold no user data and are deliberately absent.
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
];

export interface OwnedAssetRows {
  media: { url: string | null }[];
  candidates: { url: string | null }[];
  posts: { media_urls: unknown }[];
  avatars: { avatar_url: string | null }[];
}

/** Cloudinary public ids behind everything the user uploaded, deduplicated. */
export function cloudinaryIdsToDestroy(rows: OwnedAssetRows): string[] {
  const urls: (string | null | undefined)[] = [
    ...rows.media.map((r) => r.url),
    ...rows.candidates.map((r) => r.url),
    ...rows.avatars.map((r) => r.avatar_url),
    ...rows.posts.flatMap((r) => (Array.isArray(r.media_urls) ? (r.media_urls as unknown[]) : [])).map((u) =>
      typeof u === 'string' ? u : null
    ),
  ];
  const ids = new Set<string>();
  for (const u of urls) {
    if (typeof u !== 'string') continue;
    const id = publicIdFromUrl(u);
    if (id != null) ids.add(id);
  }
  return [...ids];
}
