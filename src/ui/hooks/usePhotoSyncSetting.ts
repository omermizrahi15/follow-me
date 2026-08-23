import { useCallback, useEffect, useRef, useState } from 'react';
import { isPhotoSyncEnabled, setPhotoSyncEnabled } from '../data/photoSyncConsent';
import { runCandidateSyncQuietly } from '../data/candidateSync';
import { syncBlocked } from '../data/syncStatus';

interface PhotoSyncSetting {
  /** Null until the stored preference has been read — the row renders disabled. */
  enabled: boolean | null;
  /** Flip the switch. Optimistic: the toggle answers the touch, not the write. */
  setEnabled: (enabled: boolean) => void;
  /** Re-read storage — for when something else changes it (the cloud wipe does). */
  refresh: () => void;
}

/**
 * The "Sync recent photos" switch in Settings → Privacy, and what pressing it
 * does beyond storing a boolean.
 *
 * Turning it on starts a run immediately: the publisher has just asked for
 * photos to be uploaded, and waiting for the next foreground to honour that
 * would look exactly like the switch not working. Turning it off announces the
 * new state to the sync status straight away for the same reason — the next
 * sync attempt would report it eventually, but "eventually" is how photo sync
 * being off stayed invisible for a week in the first place (issue #97).
 *
 * Deliberately not a cloud wipe: already-uploaded copies are left alone, and
 * the neighbouring "Remove my photos from the cloud" keeps that meaning to
 * itself. They age out on their own within the retention window.
 */
export function usePhotoSyncSetting(publisherId: string): PhotoSyncSetting {
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = useCallback((): void => {
    void isPhotoSyncEnabled().then(value => {
      if (mountedRef.current) setEnabledState(value);
    });
  }, []);

  useEffect(refresh, [refresh]);

  const setEnabled = useCallback(
    (next: boolean): void => {
      setEnabledState(next);
      void (async (): Promise<void> => {
        await setPhotoSyncEnabled(next);
        if (next) {
          await runCandidateSyncQuietly(publisherId, 'settings_enable_sync');
        } else {
          syncBlocked('no-consent');
        }
      })();
    },
    [publisherId],
  );

  return { enabled, setEnabled, refresh };
}
