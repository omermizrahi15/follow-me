/**
 * Volume curve for a looping song preview, so the clip eases in and out instead
 * of cutting at the loop point. Pure: callers sample it with the player's clock.
 */

export const FADE_IN_SECONDS = 1;
export const FADE_OUT_SECONDS = 1.5;

/** 0..1 volume at `currentTime` of a clip that is `duration` seconds long. */
export function previewVolume(currentTime: number, duration: number): number {
  // Until the player reports a length there is nothing to fade towards.
  if (!Number.isFinite(duration) || duration <= 0) return 1;
  const fadeIn = Math.min(currentTime / FADE_IN_SECONDS, 1);
  const fadeOut = Math.min((duration - currentTime) / FADE_OUT_SECONDS, 1);
  return Math.max(0, Math.min(fadeIn, fadeOut));
}
