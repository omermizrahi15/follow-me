import { useSyncExternalStore } from 'react';
import { connectivity } from '../../composition/container';
import { isUsable } from '../../domain/services/connectivityCopy';
import type { ConnectionStatus } from '../../domain/entities/Connectivity';

/**
 * The React side of connectivity: one shared monitor, read by any component
 * that cares.
 *
 * There is deliberately no state here. `ConnectivityMonitor` already holds it —
 * and holds it in `infrastructure/`, where the settling rules are unit-tested —
 * so this module is a `useSyncExternalStore` adapter and nothing more. A
 * context provider would have bought the same thing at the cost of a second
 * copy of the state and a provider every screen tree has to sit inside,
 * including the ones that render before the navigator.
 */

const subscribe = (listener: () => void): (() => void) => connectivity.subscribe(listener);
const getSnapshot = (): ConnectionStatus => connectivity.status;

/** The current connection status. Re-renders the caller on every change. */
export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Whether a network request is worth making. Note that this is true while the
 * status is still unknown: not having measured is not the same as being down,
 * and blocking a working connection is the worse mistake.
 */
export function useIsOnline(): boolean {
  return isUsable(useConnectionStatus());
}

/** Begin watching. Returns the stop function, for use in a React effect. */
export function startConnectivityWatch(): () => void {
  return connectivity.start();
}

/** Take a fresh reading now — what a "retry" button calls. */
export function recheckConnection(): Promise<ConnectionStatus> {
  return connectivity.refresh();
}
