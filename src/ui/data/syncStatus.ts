import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SyncPhase, SyncStatus } from '../../domain/entities/PhotoSyncStatus';

/**
 * Observable state for the candidate-photo sync, so the app can say what it is
 * doing instead of doing it invisibly.
 *
 * Before this, every sync outcome looked identical from the UI: uploading,
 * finished, switched off, and crashed were all "nothing on screen". A publisher
 * whose sync was paused by a cloud-photo wipe had no way to tell — the photos
 * simply never uploaded, and days later the server sent a "couldn't prepare
 * your post" push. This module is the missing feedback channel: `runCandidateSync`
 * writes to it, `useSyncStatus` renders it.
 *
 * State lives in memory (a sync belongs to one app run) except `lastSyncedAt`,
 * which is persisted so "synced 2h ago" survives a restart. The shape and the
 * copy derived from it live in the domain (`PhotoSyncStatus`, `photoSyncCopy`)
 * so they can be unit-tested — src/ui is excluded from jest.
 */

export type { SyncPhase, SyncStatus };

const LAST_SYNCED_KEY = 'photo-sync-last-synced-v1';

let status: SyncStatus = {
  phase: 'idle',
  uploaded: 0,
  total: 0,
  lastSyncedAt: null,
  error: null,
};

const listeners = new Set<() => void>();

function set(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

/** Current snapshot. Stable between changes, as useSyncExternalStore requires. */
export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to sync state. Re-renders on every transition. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
}

/**
 * Load the persisted `lastSyncedAt` once at startup. Best-effort: a missing or
 * unparseable value just means "never synced", which is what a fresh install
 * shows anyway.
 */
export async function restoreLastSyncedAt(): Promise<void> {
  const raw = await AsyncStorage.getItem(LAST_SYNCED_KEY).catch(() => null);
  const parsed = raw != null ? Number(raw) : NaN;
  if (Number.isFinite(parsed)) set({ lastSyncedAt: parsed });
}

/** A run is starting. `total` is how many photos are new since the last sync. */
export function syncStarted(total: number): void {
  set({ phase: 'syncing', uploaded: 0, total, error: null });
}

/** A batch committed — `uploaded` photos are now in the cloud. */
export function syncProgressed(uploaded: number): void {
  set({ uploaded });
}

/** The run finished. Stamps `lastSyncedAt`, including for a zero-upload run. */
export function syncFinished(at: number): void {
  set({ phase: 'idle', lastSyncedAt: at, error: null });
  void AsyncStorage.setItem(LAST_SYNCED_KEY, String(at)).catch(() => undefined);
}

/** The run threw. The message is shown to the user, so keep it short. */
export function syncFailed(message: string): void {
  set({ phase: 'failed', error: message });
}

/**
 * Sync didn't run because it is switched off. Distinct from `idle`: nothing is
 * happening and nothing will, until the user turns it back on.
 */
export function syncBlocked(phase: 'paused' | 'no-consent'): void {
  set({ phase, uploaded: 0, total: 0, error: null });
}

/** Test seam — resets module state between cases. */
export function resetSyncStatusForTest(): void {
  status = { phase: 'idle', uploaded: 0, total: 0, lastSyncedAt: null, error: null };
  listeners.clear();
}
