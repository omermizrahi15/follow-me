import { RequestTimeoutError, resilientFetch } from './resilientFetch';
import type { TimerHandle } from '../timers';

/** setTimeout under the test's control, so nothing actually waits. */
function fakeClock(): {
  schedule: (fn: () => void, ms: number) => TimerHandle;
  cancel: (handle: TimerHandle) => void;
  fire: () => void;
  pending: () => number;
} {
  const jobs = new Map<number, () => void>();
  let nextId = 1;
  return {
    schedule: fn => {
      const id = nextId++;
      jobs.set(id, fn);
      return id;
    },
    cancel: handle => {
      jobs.delete(handle as number);
    },
    fire: () => {
      const due = [...jobs.values()];
      jobs.clear();
      for (const fn of due) fn();
    },
    pending: () => jobs.size,
  };
}

const ok = (): Response => new Response('{}', { status: 200 });
const status = (code: number): Response => new Response('', { status: code });

function build(
  responder: (input: unknown, init: RequestInit | undefined, attempt: number) => Promise<Response>,
  options: Parameters<typeof resilientFetch>[0] = {},
): {
  fetch: ReturnType<typeof resilientFetch>;
  clock: ReturnType<typeof fakeClock>;
  waits: number[];
  attempts: () => number;
} {
  const clock = fakeClock();
  const waits: number[] = [];
  let attempts = 0;
  return {
    clock,
    waits,
    attempts: () => attempts,
    fetch: resilientFetch({
      schedule: clock.schedule,
      cancel: clock.cancel,
      sleep: ms => {
        waits.push(ms);
        return Promise.resolve();
      },
      fetchImpl: ((input: unknown, init?: RequestInit) => {
        attempts++;
        return responder(input, init, attempts);
      }) as typeof fetch,
      ...options,
    }),
  };
}

describe('resilientFetch', () => {
  it('passes a successful response straight through', async () => {
    const { fetch } = build(() => Promise.resolve(ok()));
    const res = await fetch('https://example.test/thing');
    expect(res.status).toBe(200);
  });

  it('gives up on a request that never answers', async () => {
    const { fetch, clock } = build(() => new Promise<Response>(() => undefined), { retries: 0 });
    const pending = fetch('https://example.test/hang');
    clock.fire();
    await expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it('aborts the request it gave up on, rather than leaving it running', async () => {
    let seen: AbortSignal | undefined;
    const { fetch, clock } = build((_input, init) => {
      seen = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }, { retries: 0 });
    const pending = fetch('https://example.test/hang');
    clock.fire();
    await expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
    expect(seen?.aborted).toBe(true);
  });

  it('stops the timer once an answer arrives, so a slow later tick cannot abort it', async () => {
    const { fetch, clock } = build(() => Promise.resolve(ok()));
    await fetch('https://example.test/thing');
    expect(clock.pending()).toBe(0);
  });

  it('retries a read that failed on the network', async () => {
    const { fetch, attempts } = build((_i, _init, attempt) =>
      attempt === 1 ? Promise.reject(new TypeError('Network request failed')) : Promise.resolve(ok()),
    );
    const res = await fetch('https://example.test/read');
    expect(res.status).toBe(200);
    expect(attempts()).toBe(2);
  });

  it('retries a read the server could not serve', async () => {
    const { fetch, attempts } = build((_i, _init, attempt) =>
      Promise.resolve(attempt === 1 ? status(503) : ok()),
    );
    const res = await fetch('https://example.test/read');
    expect(res.status).toBe(200);
    expect(attempts()).toBe(2);
  });

  it('backs off further with each retry', async () => {
    const { fetch, waits } = build(() => Promise.reject(new TypeError('Network request failed')), {
      retries: 3,
      backoffMs: [100, 400, 1600],
    });
    await expect(fetch('https://example.test/read')).rejects.toThrow();
    expect(waits).toEqual([100, 400, 1600]);
  });

  it('does not retry a write — repeating it could post twice', async () => {
    const { fetch, attempts } = build(() => Promise.reject(new TypeError('Network request failed')));
    await expect(fetch('https://example.test/write', { method: 'POST' })).rejects.toThrow();
    expect(attempts()).toBe(1);
  });

  it('retries a write when the caller says it is safe to repeat', async () => {
    const { fetch, attempts } = build(
      (_i, _init, attempt) => (attempt === 1 ? Promise.reject(new TypeError('boom')) : Promise.resolve(ok())),
      { retryMethods: ['GET', 'POST'] },
    );
    await fetch('https://example.test/query', { method: 'POST' });
    expect(attempts()).toBe(2);
  });

  it('does not retry a refusal — asking again gets the same no', async () => {
    const { fetch, attempts } = build(() => Promise.resolve(status(404)));
    const res = await fetch('https://example.test/missing');
    expect(res.status).toBe(404);
    expect(attempts()).toBe(1);
  });

  it('hands back the failing response once the retries are spent, rather than throwing', async () => {
    // Callers already handle a bad status; turning an exhausted retry into a
    // different failure mode would mean every one of them needs a second path.
    const { fetch, attempts } = build(() => Promise.resolve(status(500)), { retries: 2 });
    const res = await fetch('https://example.test/read');
    expect(res.status).toBe(500);
    expect(attempts()).toBe(3);
  });

  it('rethrows the last network error once the retries are spent', async () => {
    const { fetch } = build(() => Promise.reject(new TypeError('Network request failed')), { retries: 1 });
    await expect(fetch('https://example.test/read')).rejects.toThrow('Network request failed');
  });

  it('obeys a caller who aborts, and does not retry behind their back', async () => {
    const controller = new AbortController();
    const { fetch, attempts } = build((_i, init) => {
      controller.abort();
      return Promise.reject(
        Object.assign(new Error('Aborted'), { name: (init?.signal as AbortSignal).aborted ? 'AbortError' : 'Error' }),
      );
    });
    await expect(fetch('https://example.test/read', { signal: controller.signal })).rejects.toThrow();
    expect(attempts()).toBe(1);
  });

  it('passes the caller a signal that is already aborted when they aborted first', async () => {
    const controller = new AbortController();
    controller.abort();
    let seen: AbortSignal | undefined;
    const { fetch } = build((_input, init) => {
      seen = init?.signal ?? undefined;
      return Promise.resolve(ok());
    });
    await fetch('https://example.test/read', { signal: controller.signal });
    expect(seen?.aborted).toBe(true);
  });

  it('keeps the caller’s method, headers and body intact', async () => {
    let seen: RequestInit | undefined;
    const { fetch } = build((_input, init) => {
      seen = init;
      return Promise.resolve(ok());
    });
    await fetch('https://example.test/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
    expect(seen?.method).toBe('POST');
    expect(seen?.body).toBe('{"a":1}');
    expect((seen?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});
