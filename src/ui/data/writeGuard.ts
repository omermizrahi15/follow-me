import { Alert } from 'react-native';
import { connectivity } from '../../composition/container';
import { describeFailure, offlineWriteCopy } from '../../domain/services/networkError';

/**
 * One way for the whole app to handle a change that cannot be made right now
 * (issue #145).
 *
 * Two functions, deliberately: the guard for before, the alert for after. Every
 * write goes through both, so removing a follower, saving settings and deleting
 * a post all behave and read the same — which is the difference between an app
 * that handles a bad connection and an app where each screen improvises.
 *
 * Both read the connectivity monitor directly rather than through a hook: these
 * are called from event handlers, not from a render, and a hook would tie the
 * check to a component that has re-rendered.
 */

/**
 * Refuse a change the app cannot make offline, and say so. Returns true when it
 * was refused, so callers read as an early return:
 *
 * ```ts
 * if (refuseIfOffline('Removing a follower')) return;
 * ```
 *
 * Refusing beats queueing here — see `offlineWriteCopy` for why — and both beat
 * the old behaviour, which was to fire the write, let it fail somewhere in the
 * network stack, and show "Please try again".
 */
export function refuseIfOffline(action: string): boolean {
  const copy = offlineWriteCopy(connectivity.status, action);
  if (copy == null) return false;
  Alert.alert(copy.title, copy.body);
  return true;
}

/**
 * Report a write that failed after it was attempted, in the same words the
 * on-screen failure states use.
 */
export function alertFailure(error: unknown, title: string): void {
  const copy = describeFailure({ error, connection: connectivity.status, title });
  Alert.alert(copy.title, copy.hint);
}
