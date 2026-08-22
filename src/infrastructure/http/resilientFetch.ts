import {
  cancelTimer,
  scheduleTimer,
  sleep as realSleep,
  type Cancel,
  type Schedule,
  type TimerHandle,
} from '../timers';

/**
 * How long any one request may take before it is abandoned.
 *
 * An indefinite hang is worse than a fast failure: the user gets a spinner with
 * no end and no way to tell a slow network from a broken feature, and on a
 * phone that has walked out of range the request will never complete anyway —
 * the socket simply stops answering (issue #145).
 */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Photos are large and phone uplinks are slow; an upload needs far longer. */
export const UPLOAD_TIMEOUT_MS = 90_000;

const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = [400, 1_200, 3_000];

/** Methods safe to repeat: asking again cannot change anything on the server. */
const IDEMPOTENT_METHODS = ['GET', 'HEAD'];

/**
 * Statuses worth a second try — the server said "not now", not "no".
 * Everything else (401, 404, 422…) would answer the same however often it is
 * asked, and retrying only delays telling the user.
 */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Thrown when a request outlives its timeout. Distinguishable from a refusal. */
export class RequestTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms: ${url}`);
    this.name = 'RequestTimeoutError';
  }
}

export interface ResilientFetchOptions {
  timeoutMs?: number;
  /** Attempts after the first, for requests that are safe to repeat. */
  retries?: number;
  /** Wait before each retry. The last value repeats if retries outrun it. */
  backoffMs?: number[];
  /**
   * Which methods may be retried. Defaults to GET/HEAD. Widen it only for an
   * endpoint you know is idempotent server-side — the batch publish is, because
   * it claims the batch row before sending.
   */
  retryMethods?: readonly string[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  schedule?: Schedule;
  cancel?: Cancel;
}

/**
 * `fetch` with a deadline and, where it is safe, a second try (issue #145).
 *
 * Built as a fetch-shaped wrapper rather than a helper each caller remembers to
 * use, because that is the only version that actually covers everything:
 * handing it to `createClient({ global: { fetch } })` puts a timeout under
 * every Supabase query, auth call and storage request at once, including the
 * ones inside the SDK that no repository can reach.
 *
 * Retries are deliberately narrow. A dropped connection on a read is worth
 * repeating — the user is on a train and the next attempt often works — while a
 * POST that may already have been received is not, so a flaky link cannot turn
 * one post into three. Statuses follow the same rule: 503 means "not now", 404
 * means "no", and only the first is worth asking again.
 *
 * A request that exhausts its retries on a bad *status* is returned, not
 * thrown: callers already branch on `res.ok`, and inventing a second failure
 * mode would mean rewriting all of them.
 */
export function resilientFetch(options: ResilientFetchOptions = {}): typeof fetch {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const retryMethods = options.retryMethods ?? IDEMPOTENT_METHODS;
  // Resolved per call, not captured here: a wrapper built at module load would
  // pin whatever `fetch` existed at import time, before React Native's polyfill
  // (or a test's stub) has replaced it.
  const fetchImpl = options.fetchImpl;
  const sleep = options.sleep ?? realSleep;
  const schedule = options.schedule ?? scheduleTimer;
  const cancel = options.cancel ?? cancelTimer;

  return async function resilient(input, init) {
    const method = (init?.method ?? 'GET').toUpperCase();
    const mayRetry = retryMethods.some(m => m.toUpperCase() === method);
    const callerSignal = init?.signal ?? null;

    for (let attempt = 0; ; attempt++) {
      // A fresh controller per attempt: the previous one has been aborted, and
      // an aborted signal cannot be reused.
      const controller = new AbortController();
      if (callerSignal?.aborted === true) controller.abort();
      const forwardAbort = (): void => controller.abort();
      callerSignal?.addEventListener('abort', forwardAbort);

      let timer: TimerHandle = 0;
      // Raced rather than left to the abort alone. Aborting is what frees the
      // socket, but it only ends the *caller's* wait if the platform's fetch
      // honours the signal — and a fetch that hangs through its own abort is
      // precisely the spinner-forever case this exists to stop.
      const deadline = new Promise<never>((_, reject) => {
        timer = schedule(() => {
          controller.abort();
          reject(new RequestTimeoutError(String(input), timeoutMs));
        }, timeoutMs);
      });

      try {
        const response = await Promise.race([
          (fetchImpl ?? fetch)(input, { ...init, signal: controller.signal }),
          deadline,
        ]);
        if (!RETRYABLE_STATUSES.has(response.status)) return response;
        if (!mayRetry || attempt >= retries) return response;
      } catch (error) {
        // The caller pulled the plug — their intent, not a failure to retry.
        if (callerSignal?.aborted === true) throw error;
        if (!mayRetry || attempt >= retries) throw error;
      } finally {
        cancel(timer);
        callerSignal?.removeEventListener('abort', forwardAbort);
      }

      // Later attempts wait longer: a network that just failed is rarely ready
      // again immediately, and hammering it is how a weak connection is kept
      // weak. Past the end of the table the last (longest) wait repeats.
      await sleep(backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 0);
    }
  };
}
