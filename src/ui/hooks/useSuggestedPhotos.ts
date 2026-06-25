import { useCallback, useEffect, useState } from 'react';
import { loadConfig, suggestPhotos } from '../../composition/container';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';

interface State {
  loading: boolean;
  error: string | null;
  batch: PhotoClassification[];
}

/**
 * Loads the publisher's config, scans + classifies the recent library, and
 * exposes the suggested batch for the review screen. Runs lazily (on mount /
 * manual reload) so the scan + AI calls never block render.
 */
export function useSuggestedPhotos(publisherId: string): State & { reload: () => void } {
  const [state, setState] = useState<State>({ loading: true, error: null, batch: [] });

  const reload = useCallback(() => {
    setState({ loading: true, error: null, batch: [] });
    void (async (): Promise<void> => {
      try {
        const config = await loadConfig.execute(publisherId);
        const batch = await suggestPhotos.execute(config);
        setState({ loading: false, error: null, batch });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Could not build suggestions';
        setState({ loading: false, error: message, batch: [] });
      }
    })();
  }, [publisherId]);

  useEffect(() => reload(), [reload]);

  return { ...state, reload };
}
