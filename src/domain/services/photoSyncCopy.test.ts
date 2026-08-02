import { relativeTime, syncStatusCopy } from './photoSyncCopy';
import type { SyncStatus } from '../entities/PhotoSyncStatus';

const NOW = new Date('2026-08-02T12:00:00Z').getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function status(over: Partial<SyncStatus> = {}): SyncStatus {
  return { phase: 'idle', uploaded: 0, total: 0, lastSyncedAt: null, error: null, ...over };
}

describe('relativeTime', () => {
  it('rounds to the coarsest unit that still means something', () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe('just now');
    expect(relativeTime(NOW - 5 * MINUTE, NOW)).toBe('5 min ago');
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe('3h ago');
    expect(relativeTime(NOW - 26 * HOUR, NOW)).toBe('yesterday');
    expect(relativeTime(NOW - 3 * 24 * HOUR, NOW)).toBe('3 days ago');
  });

  it('never reads as negative when the stamp is ahead of the clock', () => {
    // Persisted across a device clock change, or simply written microseconds ago.
    expect(relativeTime(NOW + 5 * MINUTE, NOW)).toBe('just now');
  });
});

describe('syncStatusCopy', () => {
  it('shows real numbers while uploading, and offers no action', () => {
    const { title, action } = syncStatusCopy(status({ phase: 'syncing', uploaded: 47, total: 130 }), NOW);
    expect(title).toBe('Uploading photos… 47 of 130');
    // Nothing for the user to do but wait — and they can leave.
    expect(action).toBeNull();
  });

  it('does not claim "0 of 0" before the count is known', () => {
    const { title } = syncStatusCopy(status({ phase: 'syncing', uploaded: 0, total: 0 }), NOW);
    expect(title).toBe('Checking for new photos…');
  });

  it('offers the fix when upload is switched off', () => {
    // The bug: paused sync was indistinguishable from working sync, and the way
    // to undo it was pressing Save — which nothing told the user to do.
    for (const phase of ['paused', 'no-consent'] as const) {
      const copy = syncStatusCopy(status({ phase }), NOW);
      expect(copy.title).toBe('Photo upload is off');
      expect(copy.action).toBe('Turn on');
    }
  });

  it('distinguishes a wipe from never having consented', () => {
    const paused = syncStatusCopy(status({ phase: 'paused' }), NOW).hint;
    const never = syncStatusCopy(status({ phase: 'no-consent' }), NOW).hint;
    expect(paused).not.toBe(never);
    expect(paused).toContain('removed from the cloud');
  });

  it('surfaces the failure message and a retry', () => {
    const copy = syncStatusCopy(status({ phase: 'failed', error: 'Network request failed' }), NOW);
    expect(copy.hint).toBe('Network request failed');
    expect(copy.action).toBe('Try again');
  });

  it('falls back to generic text when a failure carries no message', () => {
    const copy = syncStatusCopy(status({ phase: 'failed' }), NOW);
    expect(copy.hint).toContain('Something went wrong');
    expect(copy.action).toBe('Try again');
  });

  it('says when it last synced, and says so plainly when it never has', () => {
    expect(syncStatusCopy(status({ lastSyncedAt: NOW - 2 * HOUR }), NOW).title).toBe(
      'Photos synced 2h ago',
    );
    expect(syncStatusCopy(status({ lastSyncedAt: null }), NOW).title).toBe('Photos not synced yet');
  });

  it('tells the user idle sync needs nothing from them', () => {
    // The whole point of the feature: photos are just synced. Nobody should
    // feel they have to press something to make it happen.
    expect(syncStatusCopy(status(), NOW).hint).toContain('you don’t need to do anything');
    expect(syncStatusCopy(status(), NOW).action).toBeNull();
  });
});
