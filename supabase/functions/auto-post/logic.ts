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
 * correctly-pluralised count, and a body that previews up to 3 captions
 * ("Sunset · Street food · Mountain view") or a generic fallback.
 */
export function approvalPushContent(captions: string[], batchLength: number): { title: string; body: string } {
  const preview = captions.slice(0, 3).filter(Boolean).join(' · ');
  const title = `${batchLength} photo${batchLength !== 1 ? 's' : ''} ready to post 📸`;
  const body = preview.length > 0 ? preview : 'Your AI-selected photos are ready to review.';
  return { title, body };
}
