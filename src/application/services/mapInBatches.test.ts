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

/** A promise the test resolves by hand, to pin down when each item finishes. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => {};
  const promise = new Promise<void>(resolve => {
    open = resolve;
  });
  return { promise, open };
}

/** Lets every already-scheduled microtask run before the test looks again. */
function settle(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('mapInBatches', () => {
  it('returns results in input order', async () => {
    const out = await mapInBatches([1, 2, 3, 4, 5], 2, n => Promise.resolve(n * 10));
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('keeps input order when the work finishes out of order', async () => {
    const gates = [gate(), gate(), gate()];
    const run = mapInBatches([0, 1, 2], 3, async n => {
      await gates[n]?.promise;
      return n;
    });

    gates[2]?.open();
    await settle();
    gates[0]?.open();
    gates[1]?.open();

    await expect(run).resolves.toEqual([0, 1, 2]);
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

  it('refills a free slot without waiting for the slow item beside it', async () => {
    const gates = [gate(), gate(), gate(), gate()];
    const started: number[] = [];

    const run = mapInBatches([0, 1, 2, 3], 2, async n => {
      started.push(n);
      await gates[n]?.promise;
      return n;
    });

    await settle();
    expect(started).toEqual([0, 1]);

    // 0 is the slow one (an iCloud original still coming down); 1 finishing
    // must hand its slot straight to 2 rather than idle until 0 is done.
    gates[1]?.open();
    await settle();
    expect(started).toEqual([0, 1, 2]);

    gates[0]?.open();
    await settle();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[2]?.open();
    gates[3]?.open();
    await expect(run).resolves.toEqual([0, 1, 2, 3]);
  });

  it('commits a result before its slot takes another item', async () => {
    const order: string[] = [];
    const commitGate = gate();

    const run = mapInBatches(
      [0, 1],
      1,
      n => {
        order.push(`map:${n}`);
        return Promise.resolve(n);
      },
      {
        onCommit: async results => {
          order.push(`commit:${results.join(',')}`);
          await commitGate.promise;
        },
      },
    );

    await settle();
    expect(order).toEqual(['map:0', 'commit:0']);

    commitGate.open();
    await run;
    expect(order).toEqual(['map:0', 'commit:0', 'map:1', 'commit:1']);
  });

  it('coalesces results that land while a commit is in flight', async () => {
    const commits: number[][] = [];
    const first = gate();
    let seen = 0;

    const out = await mapInBatches([0, 1, 2, 3], 4, n => Promise.resolve(n), {
      onCommit: async results => {
        commits.push(results);
        // Hold the first commit open long enough for the rest to pile up
        // behind it; they should arrive as one call, not three.
        if (seen++ === 0) {
          setImmediate(first.open);
          await first.promise;
        }
      },
    });

    expect(out).toEqual([0, 1, 2, 3]);
    expect(commits.length).toBeLessThan(4);
    expect(commits.flat().sort()).toEqual([0, 1, 2, 3]);
  });

  it('never runs two commits at once', async () => {
    let inCommit = 0;
    let overlapped = false;

    await mapInBatches(Array.from({ length: 8 }, (_, i) => i), 4, n => Promise.resolve(n), {
      onCommit: async () => {
        inCommit += 1;
        overlapped ||= inCommit > 1;
        await Promise.resolve();
        inCommit -= 1;
      },
    });

    expect(overlapped).toBe(false);
  });

  it('reports a running total that only rises and ends at the item count', async () => {
    const dones: number[] = [];
    await mapInBatches([1, 2, 3, 4, 5], 2, n => Promise.resolve(n), {
      onCommit: (_, done) => {
        dones.push(done);
        return Promise.resolve();
      },
    });

    expect([...dones].sort((a, b) => a - b)).toEqual(dones);
    expect(dones.at(-1)).toBe(5);
  });

  it('stops at the failing item and keeps what was already committed', async () => {
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
          onCommit: results => {
            committed.push(...results);
            return Promise.resolve();
          },
        },
      ),
    ).rejects.toThrow('boom');

    expect(committed).toEqual(expect.arrayContaining([1, 2]));
    expect(committed).not.toContain(3);
    expect(attempted).not.toContain(6);
  });

  it('propagates a failed commit', async () => {
    await expect(
      mapInBatches([1, 2], 1, n => Promise.resolve(n), {
        onCommit: () => Promise.reject(new Error('save failed')),
      }),
    ).rejects.toThrow('save failed');
  });

  it('ends early when shouldStop turns true, keeping the finished items', async () => {
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
        onCommit: results => {
          if (results.includes(2)) stop = true;
          return Promise.resolve();
        },
        shouldStop: () => Promise.resolve(stop),
      },
    );

    // Whatever was picked up before the stop is finished and returned — a
    // prefix of the input, never a hole in the middle.
    expect(out).toEqual(attempted);
    expect(out).toEqual([1, 2, ...attempted.slice(2)]);
    expect(out.length).toBeLessThan(6);
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
