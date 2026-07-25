import { useEffect } from 'react';
import { AppState } from 'react-native';
import { loadConfig, syncCandidatePhotos } from '../../composition/container';
import { hasPhotoSyncConsent, isPhotoSyncPaused } from '../data/photoSyncConsent';

/**
 * Keeps the cloud candidate set fresh for the server posting pipeline: re-syncs
 * recent library photos on mount and whenever the app returns to the foreground.
 * Both modes need it — autonomous posting selects from cloud candidates, and the
 * approval flow's server push computes its suggested batch from the same set.
 * No-op (and no uploads) until the user has consented to photo upload, and
 * while sync is paused after a cloud-photo wipe (so a "Remove my photos"
 * delete isn't immediately undone by the next foreground re-sync — it stays
 * gone until the user explicitly re-opts-in via Save).
 */
export function useAutoSync(publisherId: string | null): void {
  useEffect(() => {
    if (publisherId == null) return;

    const run = (): void => {
      void (async (): Promise<void> => {
        try {
          if (!(await hasPhotoSyncConsent())) return;
          if (await isPhotoSyncPaused()) return;
          const config = await loadConfig.execute(publisherId);
          await syncCandidatePhotos.execute(publisherId, config.lookbackDays);
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
