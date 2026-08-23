import type { SyncStatus } from '../entities/PhotoSyncStatus';

/**
 * What to tell the user about photo sync, and what (if anything) they can do
 * about it.
 *
 * Every sync outcome used to look identical from the app — which is to say,
 * look like nothing at all. Uploading, finished, switched off after a cloud
 * wipe, and failing on every attempt were indistinguishable, so a publisher
 * whose sync had been off for a week had no way to find out until the server
 * gave up and pushed "couldn't prepare your post". These strings are the fix,
 * so they are worth testing on their own.
 */

/**
 * Rounded, human "2 minutes ago" — precision past the hour is noise here.
 *
 * Floored, not rounded, at every step: elapsed time reads as "how much has
 * definitely passed". Rounding would call a sync from 30 seconds ago "1 min
 * ago", and one from 90 minutes ago "2h ago".
 */
export function relativeTime(from: number, now: number): string {
  const minutes = Math.floor((now - from) / 60_000);
  // Also catches a stamp ahead of the clock (device time changed, or a sync
  // that finished microseconds ago) — never render "-0 min ago".
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export interface SyncStatusCopy {
  title: string;
  hint: string;
  /** Label for the user's one available action, or null when there is nothing to do. */
  action: string | null;
  /**
   * Whether this state is worth putting on screen at all.
   *
   * Uploading happens on its own, on launch, on foreground, and from a
   * background task — narrating that to the publisher only invited the question
   * "when am I supposed to sync?", which has no answer because the answer is
   * never. So a working sync says nothing, and the row appears exactly when the
   * publisher is the only one who can fix it.
   */
  needsAttention: boolean;
}

export function syncStatusCopy(status: SyncStatus, now: number): SyncStatusCopy {
  switch (status.phase) {
    case 'syncing':
      return {
        title:
          status.total > 0
            ? `Uploading photos… ${status.uploaded} of ${status.total}`
            : 'Checking for new photos…',
        hint: 'You can close the app — this carries on in the background.',
        action: null,
        needsAttention: false,
      };
    case 'no-consent':
      return {
        title: 'Photo upload is off',
        // No action here. Upload is on by default now, so this state only ever
        // follows a deliberate switch-off, and the switch that undid it is the
        // one that puts it back — an extra "Turn on" beside the auto-posting
        // settings would be a second control for the same thing, in the flow
        // the toggle was moved out of.
        hint: 'Posts are prepared from private copies of your recent photos. Turn "Sync recent photos" back on in Settings → Privacy to post while the app is closed.',
        action: null,
        needsAttention: true,
      };
    case 'failed':
      return {
        title: 'Couldn’t upload photos',
        hint: status.error ?? 'Something went wrong. It will try again on its own.',
        action: 'Try again',
        needsAttention: true,
      };
    case 'idle':
      return {
        title:
          status.lastSyncedAt != null
            ? `Photos synced ${relativeTime(status.lastSyncedAt, now)}`
            : 'Photos not synced yet',
        hint: 'This happens on its own, including while the app is closed — you don’t need to do anything.',
        action: null,
        needsAttention: false,
      };
  }
}
