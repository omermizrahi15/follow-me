/**
 * The port the platform's network monitor is consumed through.
 *
 * Deliberately the smallest shape that covers what NetInfo reports: whether a
 * network is attached, and whether traffic actually reaches the internet over
 * it. Everything else NetInfo exposes (interface type, cellular generation,
 * signal strength) is out of scope until something in the app needs it.
 */

export interface ConnectionReading {
  /** A network interface is up. `null` when the platform hasn't said yet. */
  isConnected: boolean | null;
  /**
   * Traffic reaches the internet over it. `null` while the probe is still in
   * flight — which is the normal state for the first moment after launch, so
   * it must not be read as "no".
   */
  isInternetReachable: boolean | null;
}

export interface IConnectivitySource {
  /** Called on every change, and once with the current reading on subscribe. */
  subscribe(listener: (reading: ConnectionReading) => void): () => void;
  /** Force a fresh reading — what the user's "try again" ends up calling. */
  read(): Promise<ConnectionReading>;
}
