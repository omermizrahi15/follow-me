import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** One-time consent flag for uploading recent photos to the cloud. */
const SYNC_CONSENT_KEY = 'photo-sync-consent-v1';

/**
 * Set after the user wipes their cloud photos ("Remove my photos from the
 * cloud") to stop the background auto-sync from silently re-uploading them on
 * the next foreground — the delete must stick until the user explicitly opts
 * back in by hitting Save. Consent is left intact so Save doesn't re-prompt.
 */
const SYNC_PAUSED_KEY = 'photo-sync-paused-v1';

/** Whether the user has already consented to photo upload. Never prompts. */
export async function hasPhotoSyncConsent(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(SYNC_CONSENT_KEY).catch(() => null);
  return stored != null;
}

/** True while auto-sync is suspended after a cloud-photo wipe (until next Save). */
export async function isPhotoSyncPaused(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(SYNC_PAUSED_KEY).catch(() => null);
  return stored != null;
}

/** Suspend photo sync — called right after the cloud wipe succeeds. */
export async function pausePhotoSync(): Promise<void> {
  await AsyncStorage.setItem(SYNC_PAUSED_KEY, new Date().toISOString()).catch(() => undefined);
}

/** Resume photo sync. */
export async function resumePhotoSync(): Promise<void> {
  await AsyncStorage.removeItem(SYNC_PAUSED_KEY).catch(() => undefined);
}

/**
 * Whether photo sync will actually run right now — consent given AND not paused.
 * The two gates fail identically from the user's point of view ("my photos
 * aren't uploading"), so the UI asks this one question rather than both.
 */
export async function isPhotoSyncEnabled(): Promise<boolean> {
  return (await hasPhotoSyncConsent()) && !(await isPhotoSyncPaused());
}

/**
 * Turn photo sync on, prompting for consent the first time. Resolves false if
 * the user declines the prompt, in which case nothing changes.
 *
 * This is the ONLY way sync comes back after a wipe. It used to be a side
 * effect of pressing Save in the auto-posting settings, which meant a publisher
 * whose sync was paused had no way to discover it, no indication anything was
 * off, and no obvious action to take — sync stayed off for a week and every
 * scheduled post fell through to a "couldn't prepare your post" push.
 */
export async function enablePhotoSync(): Promise<boolean> {
  if (!(await confirmPhotoSync())) return false;
  await resumePhotoSync();
  return true;
}

/**
 * Photo upload is privacy-sensitive — ask explicitly the first time.
 * Resolves true when the user has consented (now or previously).
 */
export async function confirmPhotoSync(): Promise<boolean> {
  if (await hasPhotoSyncConsent()) return true;
  return new Promise(resolve => {
    Alert.alert(
      'Upload recent photos?',
      'To prepare posts for you — even while the app is closed — your recent photos are uploaded to your private cloud space. Only photos from your configured time window are uploaded.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Allow',
          onPress: () => {
            void AsyncStorage.setItem(SYNC_CONSENT_KEY, new Date().toISOString()).catch(() => undefined);
            resolve(true);
          },
        },
      ],
    );
  });
}
