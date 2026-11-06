/**
 * Stretches of a history rebuild that produced no post, grouped for display.
 *
 * A rebuild walks a hundred windows and silently drops the empty ones, so a
 * publisher who knows they shot photos in March sees a rebuild that "starts in
 * August" and has no way to tell why. Naming each stretch and the reason turns
 * that into something sayable. Pure: dates and counts in, groups out.
 */

export type SkipReason = 'no_photos' | 'unreadable' | 'none_kept';

export interface SkippedWindowLike {
  window: { start: Date; end: Date };
  reason: SkipReason;
  found: number;
}

export interface SkippedStretch {
  start: Date;
  end: Date;
  reason: SkipReason;
  /** How many cadence windows were merged into this stretch. */
  windows: number;
  /** Photos the library held across them. */
  found: number;
}

export function groupSkippedWindows(skipped: readonly SkippedWindowLike[]): SkippedStretch[] {
  const ordered = [...skipped].sort((a, b) => a.window.start.getTime() - b.window.start.getTime());
  const groups: SkippedStretch[] = [];
  for (const s of ordered) {
    const last = groups[groups.length - 1];
    if (last != null && last.reason === s.reason) {
      last.end = s.window.end;
      last.windows += 1;
      last.found += s.found;
    } else {
      groups.push({ start: s.window.start, end: s.window.end, reason: s.reason, windows: 1, found: s.found });
    }
  }
  return groups;
}

export function skippedReasonCopy(reason: SkipReason): string {
  switch (reason) {
    case 'no_photos':
      return 'No photos dated in this stretch were found in your library.';
    case 'unreadable':
      return 'Photos were found but couldn’t be read — often iCloud originals that didn’t download.';
    case 'none_kept':
      return 'Photos were found but none were kept: already posted (deleted posts count), below the quality bar, or outside your chosen categories.';
  }
}
