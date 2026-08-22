import type { ConnectionStatus } from '../entities/Connectivity';
import type { ConnectionReading } from '../interfaces/connectivity';

/**
 * Turning what the platform measures into what the app says.
 *
 * Both halves are here because both are judgement calls rather than plumbing.
 * The derivation decides when a half-known reading counts as trouble — get it
 * wrong and the app accuses a working connection of being down at every cold
 * start. The copy decides what the user is told, and the whole point of issue
 * #145 is that "please try again" told them nothing: whether to move, wait, or
 * sign in to the wifi is the answer they actually needed.
 */

export function statusFromReading(reading: ConnectionReading): ConnectionStatus {
  // No interface beats any reachability claim: a probe result outlives the
  // network it was taken on, so `isConnected: false` is the stronger signal.
  if (reading.isConnected === false) return 'offline';
  if (reading.isConnected === null) return 'unknown';
  // Only an explicit `false`. `null` means the probe hasn't finished, which is
  // the normal state for the first moment of every launch.
  if (reading.isInternetReachable === false) return 'unreachable';
  return 'online';
}

/**
 * Whether a network request is worth attempting. `unknown` counts as usable —
 * refusing to try because we haven't measured yet would strand a user whose
 * connection is fine.
 */
export function isUsable(status: ConnectionStatus): boolean {
  return status === 'online' || status === 'unknown';
}

export interface ConnectivityCopy {
  title: string;
  hint: string;
  /** Label for the user's one available action, or null when there is nothing to do. */
  action: string | null;
}

/** What to show the user, or null when the connection is fine and silence is right. */
export function connectivityCopy(status: ConnectionStatus): ConnectivityCopy | null {
  switch (status) {
    case 'offline':
      return {
        title: 'No connection',
        hint: 'Your photos are safe on this phone. Posting picks up again when you’re back online.',
        action: 'Retry',
      };
    case 'unreachable':
      return {
        title: 'This network isn’t working',
        hint: 'You’re connected, but nothing is getting through. Hotel and café wifi usually needs you to sign in first.',
        action: 'Retry',
      };
    case 'online':
    case 'unknown':
      return null;
  }
}
