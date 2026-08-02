/**
 * What the device's candidate-photo sync is doing, as the UI needs to describe
 * it. Lives in the domain rather than next to the React store so the copy that
 * renders it can be unit-tested (src/ui is excluded from jest).
 */

export type SyncPhase =
  /** Not syncing; `lastSyncedAt` says when it last did. */
  | 'idle'
  /** Uploading now — `uploaded`/`total` are meaningful. */
  | 'syncing'
  /** Suspended after a "Remove my photos from the cloud" wipe. */
  | 'paused'
  /** The upload prompt has never been accepted. */
  | 'no-consent'
  /** The last run threw; `error` carries the message. */
  | 'failed';

export interface SyncStatus {
  phase: SyncPhase;
  /** Photos uploaded so far in the current run (or the last completed one). */
  uploaded: number;
  /** Photos the current run set out to upload. 0 when there was nothing new. */
  total: number;
  /** Epoch ms of the last successful sync, or null if it has never completed. */
  lastSyncedAt: number | null;
  error: string | null;
}
