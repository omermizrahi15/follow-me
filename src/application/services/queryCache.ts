/**
 * A tiny shared cache for read queries — the data layer the app never had.
 *
 * Before this, every hook was a hand-rolled `useState` + `useEffect` fetcher
 * that owned its own copy of the data, so two components wanting the same row
 * issued two requests, and returning to a screen re-paid the whole bill from
 * scratch. Landing on the Me page cost seven round trips for three pieces of
 * data (issue #114).
 *
 * What this gives the hooks on top of it:
 *
 * - **One request per key.** Callers arriving while a fetch is in flight join
 *   it instead of starting another — the same trick as `singleFlight`, but per
 *   key and with the result kept afterwards.
 * - **Stale-while-revalidate.** A completed fetch is remembered, so a return to
 *   a screen renders instantly from the entry and refreshes behind it. A failed
 *   fetch keeps whatever data was already held: a dropped connection should not
 *   blank a screen that was showing the truth a second ago.
 * - **A shared write path.** `write` (optimistic updates) and `invalidate`
 *   (something was just published/removed/saved) reach every mounted consumer
 *   of the key, so nothing has to be told to refetch by hand.
 *
 * Deliberately not React Query: this is the whole feature set the app needs,
 * it is pure and testable outside the UI layer, and it costs no dependency.
 *
 * Not persisted — the cache lives for the life of the process. A cold start
 * fetches; that is the request this cannot avoid.
 */

export interface CacheEntry<T> {
  /** The last value fetched or written, or undefined if there has never been one. */
  readonly data: T | undefined;
  /** The last fetch failure, cleared by the next success or write. */
  readonly error: Error | undefined;
  /**
   * When the last fetch *attempt* settled, in ms — successes and failures
   * alike. Counting failures is what stops a key the server keeps rejecting
   * from being refetched on every render: it is fresh, with an error, until
   * the stale time is up. 0 means never attempted, or invalidated since.
   */
  readonly fetchedAt: number;
}

export interface QueryCache {
  /** The entry for a key, or undefined if nothing has touched it. Stable identity. */
  read: <T>(key: string) => CacheEntry<T> | undefined;
  /** Fetch (joining any request already in flight for this key) and store the result. */
  fetch: <T>(key: string, fetcher: () => Promise<T>) => Promise<T>;
  /** True when the key has no settled attempt newer than `staleTime` ms. */
  isStale: (key: string, staleTime: number) => boolean;
  /** Put a value in directly — an optimistic update, not a request. */
  write: <T>(key: string, data: T) => void;
  /** Mark every key starting with `prefix` stale, keeping its data. */
  invalidate: (prefix: string) => void;
  /** Listen for changes to one key. Returns the unsubscribe. */
  subscribe: (key: string, listener: () => void) => () => void;
}

export function createQueryCache(now: () => number = () => Date.now()): QueryCache {
  // Entries are heterogeneous by key, which no single type parameter can
  // express; the read/write pair below is the only place that has to say so.
  const entries = new Map<string, CacheEntry<unknown>>();
  const inFlight = new Map<string, Promise<unknown>>();
  const listeners = new Map<string, Set<() => void>>();

  function set(key: string, entry: CacheEntry<unknown>): void {
    entries.set(key, entry);
    for (const listener of listeners.get(key) ?? []) listener();
  }

  return {
    read<T>(key: string): CacheEntry<T> | undefined {
      return entries.get(key) as CacheEntry<T> | undefined;
    },

    fetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
      const joined = inFlight.get(key);
      if (joined !== undefined) return joined as Promise<T>;

      const run = fetcher()
        .then(data => {
          set(key, { data, error: undefined, fetchedAt: now() });
          return data;
        })
        .catch((cause: unknown) => {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          // Keep the data already held — see the stale-while-revalidate note above.
          set(key, { data: entries.get(key)?.data, error, fetchedAt: now() });
          throw error;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, run);
      return run;
    },

    isStale(key: string, staleTime: number): boolean {
      const entry = entries.get(key);
      // Never attempted, or invalidated since — stale whatever the clock says,
      // which also keeps the answer honest for a cache built at time ~0.
      if (entry == null || entry.fetchedAt === 0) return true;
      return now() - entry.fetchedAt > staleTime;
    },

    write<T>(key: string, data: T): void {
      set(key, { data, error: undefined, fetchedAt: entries.get(key)?.fetchedAt ?? now() });
    },

    invalidate(prefix: string): void {
      for (const [key, entry] of entries) {
        if (key.startsWith(prefix)) set(key, { ...entry, fetchedAt: 0 });
      }
    },

    subscribe(key: string, listener: () => void): () => void {
      const forKey = listeners.get(key) ?? new Set<() => void>();
      forKey.add(listener);
      listeners.set(key, forKey);
      return () => {
        forKey.delete(listener);
        if (forKey.size === 0) listeners.delete(key);
      };
    },
  };
}
