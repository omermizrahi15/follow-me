/**
 * What an install that predates on-by-default photo sync should carry forward.
 *
 * Photo sync is the engine behind every automatic feature: without it a
 * scheduled post has nothing to choose from and falls through to "couldn't
 * prepare your post" (issue #97). It used to be opt-in behind a modal during
 * onboarding, where "Not now" was the low-friction answer and silently broke
 * everything downstream — so it is on by default now, with the off-switch in
 * Settings → Privacy.
 *
 * The delicate part is not the default; it is the upgrade. A build that simply
 * flipped the default would re-enable uploads for publishers who deliberately
 * turned them off, which is the one outcome that would be a genuine privacy
 * violation. This is the whole of that migration, kept pure so it can be tested
 * on its own — the caller runs it only for installs that had already finished
 * onboarding, which is to say only for installs that had already been asked.
 */
export type PhotoSyncPreference = 'on' | 'off';

export interface LegacyPhotoSyncSignals {
  /**
   * Stamp written by the old opt-in alert when it was answered "Allow". Its
   * absence is the entire problem this function solves: declining left no trace
   * of its own, so on an install that was asked, nothing IS the answer.
   */
  legacyConsentAt: string | null;
  /** The old post-wipe pause flag — set only by a deliberate "delete my photos". */
  legacyPaused: boolean;
}

export function resolvePhotoSyncPreference(signals: LegacyPhotoSyncSignals): PhotoSyncPreference {
  // A wipe meant "stop, and delete what you hold". Honour it as the deliberate
  // off it was, or the next foreground re-uploads everything that was just
  // deleted (issue #72) — including on a device that had also said "Allow" at
  // some earlier point, which every wiping device had.
  if (signals.legacyPaused) return 'off';

  // Said "Allow", never took it back.
  if (signals.legacyConsentAt != null) return 'on';

  // Was asked and has nothing to show for it: declined. Default-on must not
  // reach this publisher.
  return 'off';
}
