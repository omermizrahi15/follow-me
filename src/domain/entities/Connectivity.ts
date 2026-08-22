/**
 * What the app believes about its connection to the outside world.
 *
 * Lives in the domain rather than next to the React store for the same reason
 * `PhotoSyncStatus` does: the copy derived from it, and the rules for moving
 * between states, are the parts worth unit-testing, and src/ui is excluded
 * from jest.
 */

export type ConnectionStatus =
  /** A network is up and data is getting through. */
  | 'online'
  /** No network at all — aeroplane mode, no signal, wifi off. */
  | 'offline'
  /**
   * Associated with a network that isn't passing traffic. Hotel and café wifi
   * that wants a sign-in first, a captive portal, a SIM with no data left.
   * Worth its own state because "offline" is wrong here — the phone will
   * happily report full bars — and because the fix is different: the user has
   * to go somewhere, not wait.
   */
  | 'unreachable'
  /**
   * Nothing has been measured yet, or the platform can't say. Treated as
   * online everywhere: guessing "offline" and being wrong blocks a user who
   * has a perfectly good connection, which is worse than a failed request.
   */
  | 'unknown';
