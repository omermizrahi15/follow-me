import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolvePhotoSyncPreference } from '../../domain/services/photoSyncPreference';
import { hasCompletedOnboarding } from './onboardingFlag';

/**
 * The one switch every photo upload consults, and the storage behind it.
 *
 * Sync is on unless the publisher turned it off — but "on by default" is a
 * decision that gets *written down*, once, rather than a default applied on
 * every read. Three things can write it, whichever comes first:
 *
 *   1. `migratePhotoSyncPreference`, for an install that predates this build:
 *      what it had before, carried forward (see `resolvePhotoSyncPreference`).
 *   2. The onboarding auto-posting step, which states what is uploaded above
 *      the button that accepts it.
 *   3. `defaultPhotoSyncOn`, when onboarding ends without reaching that step.
 *
 * Until one of them runs, nothing uploads. That gap is deliberate and it is the
 * reason the default is stored rather than assumed: sign-in happens at
 * onboarding step 2, and `useAutoSync` starts the moment it has a publisher id
 * — two steps before the publisher is told a single thing about photo upload.
 * A default resolved on read would have uploaded a camera roll in that window.
 *
 * Nothing here prompts. Consent is given in the open: the onboarding step
 * states it, and Settings → Privacy carries the toggle and the cloud wipe.
 */

/** The recorded preference: 'on' | 'off'. Absent until one of the three writers runs. */
const PREFERENCE_KEY = 'photo-sync-preference-v1';

/** Stamp written by the old opt-in alert on "Allow". Read once by the migration, then retired. */
const LEGACY_CONSENT_KEY = 'photo-sync-consent-v1';

/** The old "suspended after a cloud wipe" flag. Read once by the migration, then retired. */
const LEGACY_PAUSED_KEY = 'photo-sync-paused-v1';

/** Whether photo sync may run right now. One question, one answer. */
export async function isPhotoSyncEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(PREFERENCE_KEY).catch(() => null)) === 'on';
}

/**
 * Record the publisher's choice — the Settings toggle, or accepting the
 * onboarding step. This is the only way sync comes back after it is switched
 * off, which is why it is a visible control and not a side effect of saving
 * some unrelated setting.
 */
export async function setPhotoSyncEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(PREFERENCE_KEY, enabled ? 'on' : 'off').catch(() => undefined);
}

/**
 * Stop uploading — what "remove my photos from the cloud" leaves behind.
 * Without it the very next foreground would re-upload everything that was just
 * deleted, which is what makes the wipe meaningful rather than cosmetic.
 */
export async function withdrawPhotoSyncConsent(): Promise<void> {
  await setPhotoSyncEnabled(false);
}

/**
 * Apply the default when onboarding ends — including when it is skipped, which
 * is why this is not the auto-posting step's job. Never overrides a choice that
 * step (or a returning publisher's migration) already made.
 */
export async function defaultPhotoSyncOn(): Promise<void> {
  if (await hasStoredPreference()) return;
  await setPhotoSyncEnabled(true);
}

/**
 * Carry an existing install's setting across the upgrade, once.
 *
 * Runs at module scope on every launch — including the background launches iOS
 * makes for the sync task, where React never mounts — so it lands before
 * anything can upload. It does nothing on a fresh install: an install that has
 * not finished onboarding has not been through the old opt-in prompt, so there
 * is nothing to carry, and `defaultPhotoSyncOn` will settle it at the end of
 * onboarding instead.
 */
export async function migratePhotoSyncPreference(): Promise<void> {
  if (await hasStoredPreference()) return;
  if (!(await hasCompletedOnboarding())) return;

  const [legacyConsentAt, legacyPaused] = await Promise.all([
    AsyncStorage.getItem(LEGACY_CONSENT_KEY).catch(() => null),
    AsyncStorage.getItem(LEGACY_PAUSED_KEY).catch(() => null),
  ]);

  const resolved = resolvePhotoSyncPreference({
    legacyConsentAt,
    legacyPaused: legacyPaused != null,
  });

  try {
    await AsyncStorage.setItem(PREFERENCE_KEY, resolved);
    // Retired only once the answer they produced is safely written. Dropping
    // them first would leave a failed write with no signals to resolve from,
    // and the next attempt would read a publisher who had said "Allow" as one
    // who had declined.
    await AsyncStorage.multiRemove([LEGACY_CONSENT_KEY, LEGACY_PAUSED_KEY]);
  } catch {
    // Best effort. The resolution is deterministic, so the next launch reaches
    // the same answer from the same signals and tries the write again.
  }
}

async function hasStoredPreference(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(PREFERENCE_KEY).catch(() => null);
  return stored === 'on' || stored === 'off';
}
