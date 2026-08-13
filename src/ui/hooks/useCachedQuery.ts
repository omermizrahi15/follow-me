import { useCallback, useContext, useEffect, useSyncExternalStore } from 'react';
import { NavigationContext } from '@react-navigation/native';
import { queryCache } from '../../composition/container';
import type { CacheEntry } from '../../application/services/queryCache';

/**
 * How long a fetched value is trusted before a focus (or a re-render caused by
 * something else invalidating it) will refresh it. Long enough that Home →
 * Settings → Home costs nothing, short enough that a follower who subscribed
 * while the app was open shows up without a relaunch.
 */
const DEFAULT_STALE_TIME = 30_000;

interface Options {
  /** Milliseconds a fetched value is trusted for. Defaults to 30s. */
  staleTime?: number;
  /**
   * Refresh when the screen regains focus, if the value has gone stale. Off by
   * default, and deliberately opt-in rather than automatic: `useFocusEffect`
   * throws outside a navigator, and the onboarding flow renders above the
   * NavigationContainer. Turn it on for data that something *other than this
   * app* can change (a new follower); data only we write is kept correct by
   * invalidating it at the write instead.
   */
  revalidateOnFocus?: boolean;
}

export interface CachedQuery<T> {
  /** The cached value, or undefined until the first fetch lands. */
  data: T | undefined;
  /** True only before there is anything to show — never during a background refresh. */
  loading: boolean;
  error: string | null;
  /** Refetch now, regardless of staleness. Shares one request with any other caller. */
  reload: () => Promise<void>;
  /**
   * Put a value straight into the cache — an optimistic update. Every consumer
   * of the key sees it. Stable identity: it depends only on the key, so a
   * callback built on it never re-runs its callers' effects.
   */
  update: (data: T) => void;
}

/**
 * Binds a component to one key of the shared cache (issue #114).
 *
 * Every consumer of a key subscribes to the same entry, so they render the same
 * value, one request serves all of them, and a write or invalidation anywhere
 * in the app reaches all of them. Rendering is stale-while-revalidate: a cached
 * value shows immediately and any refresh happens behind it, so returning to a
 * screen never flashes a spinner over data the app already has.
 *
 * `key` is null when there is nothing to fetch yet (signed out) — the query
 * then sits idle rather than reporting a permanent load.
 */
export function useCachedQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  { staleTime = DEFAULT_STALE_TIME, revalidateOnFocus = false }: Options = {},
): CachedQuery<T> {
  const subscribe = useCallback(
    (onChange: () => void) => (key == null ? () => undefined : queryCache.subscribe(key, onChange)),
    [key],
  );
  // The cache hands back the same entry object until something changes it,
  // which is exactly the stable snapshot this needs.
  const entry = useSyncExternalStore<CacheEntry<T> | undefined>(subscribe, () =>
    key == null ? undefined : queryCache.read<T>(key),
  );

  const reload = useCallback(async (): Promise<void> => {
    if (key == null) return;
    try {
      await queryCache.fetch(key, fetcher);
    } catch {
      // The failure is on the entry, which is what the UI renders. Rethrowing
      // here would only produce an unhandled rejection in a render effect.
    }
    // `fetcher` is deliberately not a dependency — callers build a fresh
    // closure every render, and depending on it would refetch on every render.
    // The contract that makes that safe: everything the fetcher reads must be
    // part of `key`. All three data hooks key on the publisher id, which is the
    // only thing their fetchers close over.
  }, [key]);

  const refreshIfStale = useCallback((): void => {
    if (key != null && queryCache.isStale(key, staleTime)) void reload();
  }, [key, staleTime, reload]);

  // Runs on mount and again whenever the entry changes, which is how an
  // `invalidate()` from a write elsewhere pulls fresh data into every mounted
  // consumer. A settled attempt (success *or* failure) counts as fresh, so this
  // cannot spin.
  useEffect(refreshIfStale, [refreshIfStale, entry]);

  useFocusRefresh(refreshIfStale, revalidateOnFocus);

  const update = useCallback(
    (data: T): void => {
      if (key != null) queryCache.write(key, data);
    },
    [key],
  );

  return {
    data: entry?.data,
    // A value on hand, or an attempt that already failed, both mean "done".
    loading: key != null && entry?.data === undefined && entry?.error === undefined,
    error: entry?.error?.message ?? null,
    reload,
    update,
  };
}

/**
 * `useFocusEffect` for callers that opted in, and nothing at all for the rest.
 *
 * Subscribing to the screen's navigation object directly rather than through
 * `useFocusEffect` is what makes "nothing at all" possible: `useFocusEffect`
 * calls `useNavigation`, which *throws* when there is no navigator above it,
 * and onboarding renders above the NavigationContainer (see AppNavigator).
 * Reading the context ourselves gives us undefined there instead of a crash.
 */
function useFocusRefresh(refresh: () => void, enabled: boolean): void {
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    if (!enabled || navigation == null) return;
    // Already-focused screens (the common case: the hook mounts on the visible
    // screen) get no 'focus' event, so ask once up front.
    if (navigation.isFocused()) refresh();
    return navigation.addListener('focus', refresh);
  }, [enabled, navigation, refresh]);
}
