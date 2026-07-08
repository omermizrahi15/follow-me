import type { INotifier } from '../../domain/interfaces';
import type { Media } from '../../domain/entities/Media';
import type { Subscriber } from '../../domain/entities/Subscriber';

/** Called just before each send attempt (1-based). Wired to delivery logging. */
export type AttemptObserver = (subscriber: Subscriber, media: Media[], attempt: number) => Promise<void>;

const DEFAULT_RETRY_DELAYS_MS = [1_000, 4_000, 16_000];

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * INotifier decorator that retries a failed send with exponential backoff
 * (issue #11). The initial attempt plus one retry per delay — with the default
 * 1s/4s/16s that's 4 attempts total; the last error is rethrown once the
 * delays are exhausted so the caller can mark the delivery failed.
 *
 * Observer errors are swallowed: attempt bookkeeping must never block or fail
 * a send that would otherwise go through.
 */
export class RetryingNotifier implements INotifier {
  private readonly delaysMs: number[];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onAttempt?: AttemptObserver;

  constructor(
    private readonly inner: INotifier,
    options: {
      delaysMs?: number[];
      onAttempt?: AttemptObserver;
      /** Injectable for tests — production uses a real setTimeout wait. */
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {
    this.delaysMs = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.sleep = options.sleep ?? wait;
    if (options.onAttempt != null) this.onAttempt = options.onAttempt;
  }

  async notify(subscriber: Subscriber, media: Media[]): Promise<void> {
    const maxAttempts = this.delaysMs.length + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.onAttempt?.(subscriber, media, attempt);
      } catch {
        // Logging is best-effort; the send still goes out.
      }
      try {
        await this.inner.notify(subscriber, media);
        return;
      } catch (error) {
        if (attempt === maxAttempts) throw error;
        await this.sleep(this.delaysMs[attempt - 1] ?? 0);
      }
    }
  }
}
