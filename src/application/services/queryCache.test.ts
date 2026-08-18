import { createQueryCache } from './queryCache';

/** A promise plus the handles to settle it, so tests can hold a fetch open. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createQueryCache', () => {
  describe('fetch', () => {
    it('stores the result so later reads are served without another call', async () => {
      const cache = createQueryCache();

      await cache.fetch('feed:p1', () => Promise.resolve(['a']));

      expect(cache.read<string[]>('feed:p1')?.data).toEqual(['a']);
    });

    it('runs the fetcher once when several callers ask for the same key at once', async () => {
      const cache = createQueryCache();
      const pending = deferred<string>();
      const fetcher = jest.fn(() => pending.promise);

      const first = cache.fetch('profile:p1', fetcher);
      const second = cache.fetch('profile:p1', fetcher);
      pending.resolve('Ada');

      expect(await first).toBe('Ada');
      expect(await second).toBe('Ada');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('keeps different keys independent', async () => {
      const cache = createQueryCache();
      const fetcher = jest.fn((value: string) => Promise.resolve(value));

      await cache.fetch('profile:p1', () => fetcher('one'));
      await cache.fetch('profile:p2', () => fetcher('two'));

      expect(cache.read<string>('profile:p1')?.data).toBe('one');
      expect(cache.read<string>('profile:p2')?.data).toBe('two');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('starts a fresh request once the in-flight one has settled', async () => {
      const cache = createQueryCache();
      const fetcher = jest.fn(() => Promise.resolve('x'));

      await cache.fetch('feed:p1', fetcher);
      await cache.fetch('feed:p1', fetcher);

      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('records the failure, rejects the caller, and keeps the data already held', async () => {
      const cache = createQueryCache();
      await cache.fetch('feed:p1', () => Promise.resolve(['a']));

      await expect(cache.fetch('feed:p1', () => Promise.reject(new Error('offline')))).rejects.toThrow(
        'offline',
      );

      const entry = cache.read<string[]>('feed:p1');
      expect(entry?.error?.message).toBe('offline');
      // Stale data beats an empty screen — the UI keeps rendering the last feed.
      expect(entry?.data).toEqual(['a']);
    });

    it('does not wedge the key after a failure', async () => {
      const cache = createQueryCache();
      await expect(cache.fetch('feed:p1', () => Promise.reject(new Error('offline')))).rejects.toThrow();

      await cache.fetch('feed:p1', () => Promise.resolve(['a']));

      const entry = cache.read<string[]>('feed:p1');
      expect(entry?.data).toEqual(['a']);
      expect(entry?.error).toBeUndefined();
    });

    it('wraps a non-Error rejection so subscribers always get an Error', async () => {
      const cache = createQueryCache();

      await expect(cache.fetch('feed:p1', () => Promise.reject('nope'))).rejects.toBeDefined();

      expect(cache.read('feed:p1')?.error).toBeInstanceOf(Error);
    });
  });

  describe('staleness', () => {
    it('treats a key that was never fetched as stale', () => {
      const cache = createQueryCache(() => 1_000);

      expect(cache.isStale('feed:p1', 30_000)).toBe(true);
    });

    it('is fresh until the stale time has passed, then stale', async () => {
      let now = 1_000;
      const cache = createQueryCache(() => now);
      await cache.fetch('feed:p1', () => Promise.resolve(['a']));

      now = 1_000 + 30_000;
      expect(cache.isStale('feed:p1', 30_000)).toBe(false);

      now = 1_000 + 30_001;
      expect(cache.isStale('feed:p1', 30_000)).toBe(true);
    });

    it('counts a failed attempt as an attempt, so a broken key does not refetch in a loop', async () => {
      const now = 1_000;
      const cache = createQueryCache(() => now);

      await expect(cache.fetch('feed:p1', () => Promise.reject(new Error('offline')))).rejects.toThrow();

      expect(cache.isStale('feed:p1', 30_000)).toBe(false);
    });
  });

  describe('write', () => {
    it('replaces the cached data without a request', async () => {
      const cache = createQueryCache();
      await cache.fetch('subscribers:p1', () => Promise.resolve(['a', 'b']));

      cache.write('subscribers:p1', ['a']);

      expect(cache.read<string[]>('subscribers:p1')?.data).toEqual(['a']);
    });

    it('seeds a key that has never been fetched', () => {
      const cache = createQueryCache();

      cache.write('subscribers:p1', ['a']);

      expect(cache.read<string[]>('subscribers:p1')?.data).toEqual(['a']);
    });

    it('clears a recorded error — the caller has just asserted the truth', async () => {
      const cache = createQueryCache();
      await expect(cache.fetch('subscribers:p1', () => Promise.reject(new Error('offline')))).rejects.toThrow();

      cache.write('subscribers:p1', ['a']);

      expect(cache.read('subscribers:p1')?.error).toBeUndefined();
    });
  });

  describe('invalidate', () => {
    it('marks a key stale but keeps its data, so the UI has something to render', async () => {
      const now = 1_000;
      const cache = createQueryCache(() => now);
      await cache.fetch('feed:p1', () => Promise.resolve(['a']));

      cache.invalidate('feed:p1');

      expect(cache.read<string[]>('feed:p1')?.data).toEqual(['a']);
      expect(cache.isStale('feed:p1', 30_000)).toBe(true);
    });

    it('matches by prefix, so one call can drop every key of an entity', async () => {
      const now = 1_000;
      const cache = createQueryCache(() => now);
      await cache.fetch('feed:p1', () => Promise.resolve(['a']));
      await cache.fetch('feed:p2', () => Promise.resolve(['b']));
      await cache.fetch('profile:p1', () => Promise.resolve('Ada'));

      cache.invalidate('feed:');

      expect(cache.isStale('feed:p1', 30_000)).toBe(true);
      expect(cache.isStale('feed:p2', 30_000)).toBe(true);
      expect(cache.isStale('profile:p1', 30_000)).toBe(false);
    });

    it('ignores keys it has never seen', () => {
      const cache = createQueryCache();

      expect(() => cache.invalidate('feed:nobody')).not.toThrow();
    });
  });

  describe('subscribe', () => {
    it('notifies on a completed fetch', async () => {
      const cache = createQueryCache();
      const listener = jest.fn();
      cache.subscribe('feed:p1', listener);

      await cache.fetch('feed:p1', () => Promise.resolve(['a']));

      expect(listener).toHaveBeenCalled();
    });

    it('notifies on a failed fetch', async () => {
      const cache = createQueryCache();
      const listener = jest.fn();
      cache.subscribe('feed:p1', listener);

      await expect(cache.fetch('feed:p1', () => Promise.reject(new Error('offline')))).rejects.toThrow();

      expect(listener).toHaveBeenCalled();
    });

    it('notifies on write and on invalidate', async () => {
      const cache = createQueryCache();
      await cache.fetch('feed:p1', () => Promise.resolve(['a']));
      const listener = jest.fn();
      cache.subscribe('feed:p1', listener);

      cache.write('feed:p1', ['b']);
      cache.invalidate('feed:p1');

      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('notifies every subscriber of the key — that is what makes the fetch shared', async () => {
      const cache = createQueryCache();
      const one = jest.fn();
      const two = jest.fn();
      cache.subscribe('feed:p1', one);
      cache.subscribe('feed:p1', two);

      await cache.fetch('feed:p1', () => Promise.resolve(['a']));

      expect(one).toHaveBeenCalled();
      expect(two).toHaveBeenCalled();
    });

    it('leaves other keys alone', async () => {
      const cache = createQueryCache();
      const listener = jest.fn();
      cache.subscribe('profile:p1', listener);

      await cache.fetch('feed:p1', () => Promise.resolve(['a']));

      expect(listener).not.toHaveBeenCalled();
    });

    it('stops notifying once unsubscribed', async () => {
      const cache = createQueryCache();
      const listener = jest.fn();
      const unsubscribe = cache.subscribe('feed:p1', listener);

      unsubscribe();
      await cache.fetch('feed:p1', () => Promise.resolve(['a']));

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('entry identity', () => {
    // useSyncExternalStore re-renders whenever the snapshot changes identity, so
    // an entry that is rebuilt on every read would loop the whole UI.
    it('is stable across reads while nothing has changed', async () => {
      const cache = createQueryCache();
      await cache.fetch('feed:p1', () => Promise.resolve(['a']));

      expect(cache.read('feed:p1')).toBe(cache.read('feed:p1'));
    });

    it('changes when the entry changes', async () => {
      const cache = createQueryCache();
      await cache.fetch('feed:p1', () => Promise.resolve(['a']));
      const before = cache.read('feed:p1');

      cache.write('feed:p1', ['b']);

      expect(cache.read('feed:p1')).not.toBe(before);
    });

    it('is undefined for a key nothing has touched', () => {
      const cache = createQueryCache();

      expect(cache.read('feed:p1')).toBeUndefined();
    });
  });
});
