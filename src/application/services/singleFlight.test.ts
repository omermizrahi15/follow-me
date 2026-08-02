import { singleFlight } from './singleFlight';

/** A promise whose settlement the test controls. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('singleFlight', () => {
  it('runs the function once for calls that overlap', async () => {
    const gate = deferred<string>();
    const fn = jest.fn().mockReturnValue(gate.promise);
    const guarded = singleFlight(fn);

    const first = guarded();
    const second = guarded();
    const third = guarded();
    gate.resolve('done');

    expect(await Promise.all([first, second, third])).toEqual(['done', 'done', 'done']);
    // The whole point: a background task firing as the user opens the app must
    // not upload the same photos twice (double bandwidth, double peak RAM).
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh run once the previous one has settled', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const guarded = singleFlight(fn);

    await guarded();
    await guarded();

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not wedge after a rejection — the next caller gets a new attempt', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce('recovered');
    const guarded = singleFlight(fn);

    await expect(guarded()).rejects.toThrow('network down');
    // A cached rejected promise would make every later sync fail forever — the
    // failure mode this guard would otherwise introduce.
    await expect(guarded()).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rejects every joined caller when the shared run fails', async () => {
    const gate = deferred<string>();
    const guarded = singleFlight(jest.fn().mockReturnValue(gate.promise));

    const first = guarded();
    const second = guarded();
    gate.reject(new Error('upload failed'));

    await expect(first).rejects.toThrow('upload failed');
    await expect(second).rejects.toThrow('upload failed');
  });

  it('passes the first caller’s arguments through, and ignores the joiner’s', async () => {
    const gate = deferred<string>();
    const fn = jest.fn().mockReturnValue(gate.promise);
    const guarded = singleFlight(fn);

    const first = guarded('pub-1', 3);
    const second = guarded('pub-1', 30);
    gate.resolve('done');
    await Promise.all([first, second]);

    // Documented semantics: the joiner takes the running answer. For photo sync
    // that is harmless — a wider lookback lands on the next trigger — but it
    // would be a bug in a caller expecting its own parameters to be honoured.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('pub-1', 3);
  });
});
