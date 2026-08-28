import { getAiUsage } from '../../composition/container';
import type { AiUsageSummary } from '../../domain/entities/AiUsage';
import { useCachedQuery, type CachedQuery } from './useCachedQuery';

/**
 * How stale a usage reading may be before a focus refreshes it.
 *
 * Short, because the number moves while the app is in the foreground: a single
 * scan spends dozens of photos in under a minute, and a bar that still claims
 * 12% after one is worse than no bar. It is one cheap GET, and only the staging
 * build ever mounts a consumer.
 */
const STALE_TIME = 10_000;

/**
 * Today's AI budget for the signed-in publisher.
 *
 * `publisherId` is only the cache key — the server reads the count for whoever
 * the JWT belongs to, and cannot be asked about anyone else. Null (signed out)
 * leaves the query idle rather than reporting a permanent load.
 */
export function useAiUsage(publisherId: string | null): CachedQuery<AiUsageSummary> {
  return useCachedQuery<AiUsageSummary>(
    publisherId == null ? null : `ai-usage:${publisherId}`,
    () => getAiUsage.execute(),
    { staleTime: STALE_TIME, revalidateOnFocus: true },
  );
}
