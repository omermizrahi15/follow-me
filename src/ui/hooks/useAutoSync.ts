import { useEffect } from 'react';
import { AppState } from 'react-native';
import { loadConfig, syncCandidatePhotos } from '../../composition/container';

/**
 * Keeps the cloud candidate set fresh for autonomous posting: when the publisher
 * has approval turned off, re-syncs recent library photos on mount and whenever
 * the app returns to the foreground. No-op (and no uploads) when approval is on.
 */
export function useAutoSync(publisherId: string | null): void {
  useEffect(() => {
    if (publisherId == null) return;

    const run = (): void => {
      void (async (): Promise<void> => {
        try {
          const config = await loadConfig.execute(publisherId);
          if (!config.requireApproval) {
            await syncCandidatePhotos.execute(publisherId, config.lookbackDays);
          }
        } catch {
          /* best-effort background sync */
        }
      })();
    };

    run();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') run();
    });
    return () => sub.remove();
  }, [publisherId]);
}
