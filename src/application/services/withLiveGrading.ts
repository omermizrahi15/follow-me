import type { GradingCoordinator } from './GradingCoordinator';

/**
 * Returns `target` with its two grading entry points — the publisher's own scan
 * and the "+" top-up — holding a live-grading lease for as long as they run.
 * Background pre-grading sees the lease and yields (see GradingCoordinator).
 *
 * Everything else, including instance state, falls through to `target`.
 */
export function withLiveGrading<
  T extends {
    execute(...args: never[]): Promise<unknown>;
    classifyMore(...args: never[]): Promise<unknown>;
  },
>(target: T, coordinator: GradingCoordinator): T {
  const leased = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const release = await coordinator.beginInteractive();
      try {
        return await fn.apply(target, args);
      } finally {
        release();
      }
    };
  return Object.assign(Object.create(target) as T, {
    execute: leased(target.execute.bind(target) as (...a: unknown[]) => Promise<unknown>),
    classifyMore: leased(target.classifyMore.bind(target) as (...a: unknown[]) => Promise<unknown>),
  });
}
