// Pure helpers for the auto-post service, split out of index.ts for unit
// testing. Scheduling itself lives in _shared/autoPostSchedule.ts; the batch
// selection in _shared/photoSelection.ts — both already covered.

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
export type ReminderReason = 'no-candidates' | 'empty-batch';

/**
 * Title/body for the fallback reminder push. The two failure modes need
 * different user action (sync photos vs. loosen filters / take new shots),
 * so the copy distinguishes them — and the reason lands in telemetry.
 */
export function reminderPushContent(reason: ReminderReason): { title: string; body: string } {
  const body =
    reason === 'no-candidates'
      ? 'No recent photos have synced yet — open the app to upload some.'
      : "None of your recent photos fit your filters — tap to choose some yourself.";
  return { title: 'Ready for your next post?', body };
}
