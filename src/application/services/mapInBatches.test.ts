import { mapInBatches } from './mapInBatches';

/** Records peak concurrency while running `fn` through the tracker. */
function concurrencyTracker(): { wrap: <T>(fn: () => Promise<T>) => Promise<T>; peak: () => number } {
  let inFlight = 0;
  let peak = 0;
  return {
    wrap: async fn => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Yield so overlapping calls actually accumulate before any resolves.
      await Promise.resolve();
      try {
        return await fn();
      } finally {
        inFlight -= 1;
      }
    },
    peak: () => peak,
  };
}

describe('mapInBatches', () => {
  it('returns results in input order', async () => {
    const out = await mapInBatches([1, 2, 3, 4, 5], 2, n => Promise.resolve(n * 10));
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('passes the original index alongside each item', async () => {
    const out = await mapInBatches(['a', 'b', 'c'], 2, (item, i) => Promise.resolve(`${i}:${item}`));
    expect(out).toEqual(['0:a', '1:b', '2:c']);
  });

  it('never runs more than `size` calls at once', async () => {
    const tracker = concurrencyTracker();
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapInBatches(items, 3, n => tracker.wrap(() => Promise.resolve(n)));

    expect(tracker.peak()).toBeLessThanOrEqual(3);
  });

  it('runs strictly one at a time at size 1', async () => {
    const tracker = concurrencyTracker();
    const out = await mapInBatches([1, 2, 3, 4], 1, n => tracker.wrap(() => Promise.resolve(n)));

    expect(out).toEqual([1, 2, 3, 4]);
    expect(tracker.peak()).toBe(1);
  });

  it('commits each batch before starting the next', async () => {
    const order: string[] = [];
    await mapInBatches(
      [1, 2, 3, 4],
      2,
      n => {
        order.push(`map:${n}`);
        return Promise.resolve(n);
      },
      {
        onBatch: batch => {
          order.push(`commit:${batch.join(',')}`);
          return Promise.resolve();
        },
      },
    );

    expect(order).toEqual(['map:1', 'map:2', 'commit:1,2', 'map:3', 'map:4', 'commit:3,4']);
  });

  it('reports where each batch started', async () => {
    const starts: number[] = [];
    await mapInBatches([1, 2, 3, 4, 5], 2, n => Promise.resolve(n), {
      onBatch: (_, startIndex) => {
        starts.push(startIndex);
        return Promise.resolve();
      },
    });
    expect(starts).toEqual([0, 2, 4]);
  });

  it('stops at the failing batch and keeps what was already committed', async () => {
    const committed: number[] = [];
    const attempted: number[] = [];

    await expect(
      mapInBatches(
        [1, 2, 3, 4, 5, 6],
        2,
        n => {
          attempted.push(n);
          return n === 3 ? Promise.reject(new Error('boom')) : Promise.resolve(n);
        },
        {
          onBatch: batch => {
            committed.push(...batch);
            return Promise.resolve();
          },
        },
      ),
    ).rejects.toThrow('boom');

    expect(committed).toEqual([1, 2]);
    expect(attempted).not.toContain(5);
  });

  it('ends early when shouldStop turns true, keeping the finished batches', async () => {
    const attempted: number[] = [];
    let stop = false;

    const out = await mapInBatches(
      [1, 2, 3, 4, 5, 6],
      2,
      n => {
        attempted.push(n);
        return Promise.resolve(n);
      },
      {
        onBatch: batch => {
          if (batch.includes(2)) stop = true;
          return Promise.resolve();
        },
        shouldStop: () => Promise.resolve(stop),
      },
    );

    expect(out).toEqual([1, 2]);
    expect(attempted).toEqual([1, 2]);
  });

  it('does nothing for an empty list', async () => {
    const fn = jest.fn();
    const shouldStop = jest.fn();
    await expect(mapInBatches([], 3, fn, { shouldStop })).resolves.toEqual([]);
    expect(fn).not.toHaveBeenCalled();
    expect(shouldStop).not.toHaveBeenCalled();
  });

  it('rejects a size that would hang or run backwards', async () => {
    const fn = jest.fn();
    await expect(mapInBatches([1, 2], 0, fn)).rejects.toThrow('must be a positive integer');
    await expect(mapInBatches([1, 2], -1, fn)).rejects.toThrow('must be a positive integer');
    await expect(mapInBatches([1, 2], 1.5, fn)).rejects.toThrow('must be a positive integer');
    expect(fn).not.toHaveBeenCalled();
  });
});
