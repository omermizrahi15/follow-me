import { useEffect } from 'react';
import { AppState } from 'react-native';
import { runCandidateSyncQuietly } from '../data/candidateSync';

/**
 * Keeps the cloud candidate set fresh for the server posting pipeline: re-syncs
 * recent library photos on mount and whenever the app returns to the foreground.
 * Both modes need it — autonomous posting selects from cloud candidates, and the
 * approval flow's server push computes its suggested batch from the same set.
 *
 * The gates (consent, and the pause a cloud-photo wipe sets) live in
 * `runCandidateSync`, shared with the background notification task so a
 * server-triggered sync behaves identically to this one.
 */
export function useAutoSync(publisherId: string | null): void {
  useEffect(() => {
    if (publisherId == null) return;

    // Still best-effort for the user — a failed sync must never surface as an
    // error in the UI — but no longer silent. When this fails the server has
    // nothing to post from and the publisher finds out days later via an empty
    // notification (issue #97). Sentry finds out now.
    const run = (): void => void runCandidateSyncQuietly(publisherId, 'auto_sync_candidates');

    run();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') run();
    });
    return () => sub.remove();
  }, [publisherId]);
}
