import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import type { ConnectionReading, IConnectivitySource } from '../../domain/interfaces';

/**
 * `IConnectivitySource` backed by the platform's own network stack.
 *
 * Kept to the adapter and nothing else: no state, no decisions, no timers —
 * those live in `ConnectivityMonitor`, where they can be tested without a
 * device. This file is the part that cannot be, so there is deliberately
 * nothing in it to get wrong.
 *
 * `isInternetReachable` is NetInfo's own probe (a 204 endpoint it polls), which
 * is what gives us captive portals for free: hotel wifi answers the probe with
 * its sign-in page rather than a 204, so the reading comes back connected but
 * unreachable — the distinction issue #145 asked for.
 */
const toReading = (state: NetInfoState): ConnectionReading => ({
  isConnected: state.isConnected,
  isInternetReachable: state.isInternetReachable,
});

export const netInfoSource: IConnectivitySource = {
  subscribe: listener => NetInfo.addEventListener(state => listener(toReading(state))),
  read: async () => toReading(await NetInfo.fetch()),
};
