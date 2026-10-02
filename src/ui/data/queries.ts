import { queryCache } from '../../composition/container';

/**
 * The cache keys the app reads, and the invalidations that keep them honest
 * (issue #114).
 *
 * One key per (entity, publisher): every hook and screen asking for the same
 * thing lands on the same entry, which is what collapses the Me page's seven
 * requests into three. Keys are namespaced by entity so a whole entity can be
 * dropped with the shared prefix.
 *
 * The invalidations are the other half of the deal. Refetching on every screen
 * focus used to be how the app stayed correct; with a cache, correctness comes
 * from telling it what changed at the moment it changes, which is both cheaper
 * and more accurate — a post deleted from the story viewer now updates the feed
 * and the map, which the old blanket refetch on Home never did because Home
 * never lost focus.
 */

export const feedKey = (publisherId: string): string => `feed:${publisherId}`;
export const profileKey = (publisherId: string): string => `profile:${publisherId}`;
export const subscribersKey = (publisherId: string): string => `subscribers:${publisherId}`;
export const postingConfigKey = (publisherId: string): string => `posting-config:${publisherId}`;

/** The feed changed: a post was shared, trashed or restored. */
export function invalidateFeed(publisherId: string | null): void {
  if (publisherId != null) queryCache.invalidate(feedKey(publisherId));
}

/**
 * The auto-posting config changed. Home reads the cadence from it to decide
 * which stretches of the trip are missing a posting, so a publisher who
 * switches from weekly to every three days must not keep seeing gaps measured
 * the old way.
 */
export function invalidatePostingConfig(publisherId: string | null): void {
  if (publisherId != null) queryCache.invalidate(postingConfigKey(publisherId));
}

/** The profile changed: name, photo or trip start date was saved. */
export function invalidateProfile(publisherId: string | null): void {
  if (publisherId != null) queryCache.invalidate(profileKey(publisherId));
}

/**
 * The follower list needs re-reading. Only used to recover from a failed
 * removal: the successful path writes the shortened list straight into the
 * cache, and followers who arrive through the invite link do so without the app
 * knowing at all — which is why that one query also still refreshes on focus.
 */
export function invalidateSubscribers(publisherId: string | null): void {
  if (publisherId != null) queryCache.invalidate(subscribersKey(publisherId));
}
