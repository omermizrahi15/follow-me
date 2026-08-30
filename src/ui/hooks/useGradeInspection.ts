import { useCallback, useEffect, useState } from 'react';
import { inspectGrades, loadConfig } from '../../composition/container';
import type { GradeInspection } from '../../application/usecases/InspectGradesUseCase';

// Re-exported so the screen can name the shape it renders without reaching past
// this hook into the application layer, which the layer rules forbid.
export type { GradeInspection };

export interface GradeInspectionState {
  data: GradeInspection | null;
  loading: boolean;
  /** The read failed. Shown as itself — an empty list would say "nothing graded". */
  error: Error | null;
  reload: () => void;
}

/**
 * Everything the AI currently believes about this device's photos.
 *
 * Not a cached query, unlike {@link useAiUsage}: the whole reason to open this
 * screen is to look at the state right now, usually straight after changing a
 * setting or running a scan, and a stale-time window would quietly answer with
 * the state from before the thing being investigated.
 */
export function useGradeInspection(publisherId: string | null): GradeInspectionState {
  const [data, setData] = useState<GradeInspection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    if (publisherId == null) return;
    // Held in an object rather than a plain `let`, matching usePlaceSplit: a
    // closure variable mutated only by the cleanup reads as a constant to
    // TypeScript's flow analysis, so every `if (!cancelled)` below would be
    // flagged as a check that can never fail.
    const run = { cancelled: false };
    const isStale = (): boolean => run.cancelled;

    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const config = await loadConfig.execute(publisherId);
        const inspection = await inspectGrades.execute(config);
        if (!isStale()) setData(inspection);
      } catch (err) {
        // Reported rather than smoothed into an empty result: "the read failed"
        // and "the AI has graded nothing" look identical as an empty list and
        // mean opposite things.
        if (!isStale()) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!isStale()) setLoading(false);
      }
    })();

    return () => {
      run.cancelled = true;
    };
  }, [publisherId, nonce]);

  return { data, loading, error, reload };
}
