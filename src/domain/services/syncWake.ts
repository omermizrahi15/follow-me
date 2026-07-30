/**
 * Recognising the server's silent "sync your photos" push (issue #97).
 *
 * The background notification task is handed the raw remote message, and its
 * shape is not stable across platforms or expo-notifications versions: iOS
 * nests the Expo `data` object under `body`, Android delivers it under
 * `notification.data`, and a foreground listener passes the `data` object
 * itself. Rather than bet on one, look for the marker wherever it can appear —
 * a false negative here means the phone never syncs and the publisher's next
 * post arrives empty, which is the exact bug this whole path exists to prevent.
 */

/** Marker the auto-post job puts in the silent push's data payload. */
export const SYNC_WAKE_TYPE = 'sync-candidates';

/** Payload nestings the marker has been observed under, deepest last. */
const CANDIDATE_PATHS = [[], ['body'], ['data'], ['body', 'data'], ['notification', 'data']] as const;

function at(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (node, key) =>
      typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined,
    value,
  );
}

/** Whether this background-notification payload is the server's sync wake. */
export function isSyncWakePayload(payload: unknown): boolean {
  return CANDIDATE_PATHS.some(path => {
    const node = at(payload, path);
    return (
      typeof node === 'object' &&
      node !== null &&
      (node as Record<string, unknown>)['type'] === SYNC_WAKE_TYPE
    );
  });
}
