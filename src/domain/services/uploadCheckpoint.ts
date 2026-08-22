/**
 * What a half-finished post already got into the cloud (issue #145).
 *
 * Sharing ten photos on a hotel connection is ten chances to fail, and the
 * failure used to cost everything: the whole selection re-uploaded from photo
 * one, re-decoding every bitmap, on the same connection that had just proved it
 * could not carry them. Remembering the urls turns a retry into "finish the
 * three that are left".
 *
 * Pure, so the rules that make it safe — what counts as still valid, and what
 * merging two attempts means — are testable without a store behind them.
 */

export interface UploadCheckpoint {
  /** When this checkpoint was last written, epoch ms. */
  at: number;
  /** mediaId → the url that item is already hosted at. */
  urls: Record<string, string>;
}

/**
 * How long a remembered upload may be reused.
 *
 * Long enough to cover the realistic case — a post abandoned in a dead spot and
 * finished the next morning — and short enough that a url which has since been
 * pruned by the retention job is never posted as if it were live.
 */
export const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000;

/** Fold this attempt's uploads into what was already remembered. */
export function withUploads(
  existing: UploadCheckpoint | null,
  uploads: readonly { mediaId: string; url: string }[],
  now: number,
): UploadCheckpoint {
  return {
    at: now,
    urls: {
      ...(existing?.urls ?? {}),
      ...Object.fromEntries(uploads.map(u => [u.mediaId, u.url])),
    },
  };
}

/**
 * The urls still worth reusing. An expired checkpoint yields nothing rather
 * than a partial set: half-trusting it is how a post ends up mixing fresh
 * photos with links that 404.
 */
export function usableUploads(
  checkpoint: UploadCheckpoint | null,
  now: number,
  ttlMs: number = CHECKPOINT_TTL_MS,
): Record<string, string> {
  if (checkpoint == null) return {};
  // Also covers a clock that has moved backwards (travel across timezones is
  // this app's whole subject) — an `at` in the future is not evidence of
  // freshness, so treat it as unusable.
  const age = now - checkpoint.at;
  if (age < 0 || age > ttlMs) return {};
  return checkpoint.urls;
}
