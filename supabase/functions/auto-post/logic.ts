// Pure helpers for the auto-post service, split out of index.ts for unit
// testing. Scheduling itself lives in the app's domain layer
// (src/domain/services/autoPostSchedule.ts), the batch selection in
// src/domain/services/photoSelection.ts — both already covered.

/**
 * Split `items` into consecutive groups of at most `size`, in order.
 *
 * Used to keep each classify-photos request under that function's own
 * MAX_PHOTOS_PER_REQUEST cap: a whole lookback window in one body is answered
 * with a 400, which reads at this end as "the posting failed" rather than "ask
 * for less at a time".
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunk: size must be a positive integer, got ${size}`);
  }
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/** Split a "HH:MM" schedule time into numbers (invalid parts fall back to 0 at the call site). */
export function parseNotifyTime(notifyTime: string): { hour: number; minute: number } {
  const [hour, minute] = notifyTime.split(':').map(Number);
  return { hour: hour ?? 0, minute: minute ?? 0 };
}

/**
 * Title/body for the "batch ready to review" rich push: a title with a
 * correctly-pluralised count and — when the batch carries a location — the
 * place it was shot ("3 photos from Tel Aviv ready to post 📸"), and a body
 * that previews up to 3 captions ("Sunset · Street food · Mountain view") or a
 * generic fallback.
 */
export function approvalPushContent(
  captions: string[],
  batchLength: number,
  place?: string | null,
): { title: string; body: string } {
  const preview = captions.slice(0, 3).filter(Boolean).join(' · ');
  const where = place != null && place.trim() !== '' ? ` from ${place.trim()}` : '';
  const title = `${batchLength} photo${batchLength !== 1 ? 's' : ''}${where} ready to post 📸`;
  const body = preview.length > 0 ? preview : 'Your AI-selected photos are ready to review.';
  return { title, body };
}

/** Why the pipeline fell back to a pick-manually reminder instead of a photo batch. */
export type ReminderReason = 'no-candidates' | 'empty-batch' | 'stale-client' | 'sync-off';

/**
 * Title/body for the fallback reminder push. The failure modes need different
 * user action (take/pick photos vs. loosen filters vs. open the app at all), so
 * the copy distinguishes them — and the reason lands in telemetry.
 *
 * The titles deliberately do NOT read like "your batch is ready": issue #97 was
 * a fallback that looked exactly like the real post notification but arrived
 * with no thumbnail, place, or gallery. A fallback should announce itself.
 */
export function reminderPushContent(reason: ReminderReason): { title: string; body: string } {
  switch (reason) {
    case 'sync-off':
      // The device told us upload is switched off (paused by a cloud-photo wipe,
      // or never consented to). "Open the app" is useless advice here — it was
      // opened plenty; the flag kept sync off regardless. Name the actual fix.
      return {
        title: 'Photo upload is switched off',
        body: 'Turn it back on in Auto-posting settings so Follow Me can prepare your next post.',
      };
    case 'stale-client':
      // The phone hasn't checked in, so we can't know whether there are photos.
      // Don't accuse the user of having nothing — ask them to open the app.
      return {
        title: "Couldn't prepare your post",
        body: 'Open Follow Me so your recent photos can upload — your next post is picked from them.',
      };
    case 'no-candidates':
      // The app IS syncing (recent heartbeat); there genuinely are no new photos.
      return {
        title: 'Nothing new to post yet',
        body: 'No new photos since your last post — take a few, or open the app to pick older ones.',
      };
    case 'empty-batch':
      return {
        title: 'Nothing new to post yet',
        body: 'None of your recent photos fit your filters — tap to choose some yourself.',
      };
  }
}

// --- Sync grace window (issue #97) -----------------------------------------
//
// Cloud candidates are uploaded by the app, and until the background sync is on
// every device that only happens while it is open. Rather than firing a
// contentless reminder the instant a due tick finds an empty cloud set — and
// stamping the schedule, which pushed the next real attempt a full interval
// away — the job holds the slot open, nudges the phone to sync, and re-checks
// every cron tick. The reminder is the last resort, not the first response.

/** How long the job keeps the posting slot open waiting for the phone to sync. */
export const SYNC_GRACE_MS = 4 * 60 * 60 * 1000;
/** Minimum spacing between silent wake pushes (iOS budgets background pushes). */
export const WAKE_PUSH_INTERVAL_MS = 45 * 60 * 1000;
/** A heartbeat older than this means the phone isn't syncing, not that it has nothing. */
export const CLIENT_STALE_MS = 48 * 60 * 60 * 1000;

export interface SyncGraceInput {
  /** When the empty cloud set was first seen at a due tick; null on first sight. */
  pendingSince: Date | null;
  /** When the last silent wake push went out, for throttling. */
  lastWakePushAt: Date | null;
  /** Last successful client sync (heartbeat), used to word the give-up reminder. */
  lastClientSyncAt: Date | null;
  /**
   * What the device last said its photo sync was doing (migration 20240027).
   * `null` is a device predating the column — fall back to heartbeat-only
   * reasoning so old builds keep behaving as they did.
   */
  syncState: 'active' | 'paused' | 'no-consent' | null;
  now: Date;
}

export type SyncGraceDecision =
  /** Still inside the grace window — hold the slot; `nudge` says whether to wake the phone now. */
  | { kind: 'wait'; nudge: boolean }
  /** Grace expired — send this reminder once, stamp the schedule, clear the pending state. */
  | { kind: 'give-up'; reason: ReminderReason };

/**
 * What to do about a due posting whose cloud photo set is empty.
 *
 * `pendingSince == null` is the first sighting, so elapsed is 0 and the answer
 * is always `wait` with a nudge — the phone gets its chance before the user
 * ever sees anything.
 */
export function syncGraceDecision(input: SyncGraceInput): SyncGraceDecision {
  const { pendingSince, lastWakePushAt, lastClientSyncAt, syncState, now } = input;

  // Upload is switched off on the device. Waiting four hours and spending
  // background push budget waking a phone that will decline to sync is theatre:
  // no photo can arrive until the user turns it back on, so say so immediately.
  if (syncState === 'paused' || syncState === 'no-consent') {
    return { kind: 'give-up', reason: 'sync-off' };
  }

  const elapsed = pendingSince != null ? now.getTime() - pendingSince.getTime() : 0;

  if (elapsed >= SYNC_GRACE_MS) {
    const clientStale =
      lastClientSyncAt == null || now.getTime() - lastClientSyncAt.getTime() >= CLIENT_STALE_MS;
    return { kind: 'give-up', reason: clientStale ? 'stale-client' : 'no-candidates' };
  }

  const nudge =
    lastWakePushAt == null || now.getTime() - lastWakePushAt.getTime() >= WAKE_PUSH_INTERVAL_MS;
  return { kind: 'wait', nudge };
}
