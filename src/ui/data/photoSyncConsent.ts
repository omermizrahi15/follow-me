import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** One-time consent flag for uploading recent photos to the cloud. */
const SYNC_CONSENT_KEY = 'photo-sync-consent-v1';

/**
 * Legacy "suspended after a cloud wipe" flag. A wipe now withdraws consent
 * outright (see `wipeAndStopPhotoSync`), which the UI already has a name and an
 * action for — the extra flag only ever produced a second off-state that looked
 * identical to the first and had to be explained twice. Still cleared on the way
 * past so a device that paused under the old build isn't stuck off forever.
 */
const LEGACY_SYNC_PAUSED_KEY = 'photo-sync-paused-v1';

/** Whether the user has already consented to photo upload. Never prompts. */
export async function hasPhotoSyncConsent(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(SYNC_CONSENT_KEY).catch(() => null);
  return stored != null;
}

/**
 * Whether photo sync will actually run right now. One question, one answer.
 *
 * The legacy pause is still honoured as "off" rather than ignored: a device
 * that wiped its cloud photos under the old build would otherwise re-upload
 * them on the next foreground, which is precisely the bug the pause existed to
 * prevent. It reads as no-consent to the UI, so the fix is the same visible
 * "Turn on" either way.
 */
export async function isPhotoSyncEnabled(): Promise<boolean> {
  if (!(await hasPhotoSyncConsent())) return false;
  const paused = await AsyncStorage.getItem(LEGACY_SYNC_PAUSED_KEY).catch(() => null);
  return paused == null;
}

/**
 * Stop uploading and forget the consent — what "remove my photos from the
 * cloud" leaves behind. Without this the very next foreground would re-upload
 * everything the user just deleted, which is what makes the wipe meaningful
 * rather than cosmetic.
 */
export async function withdrawPhotoSyncConsent(): Promise<void> {
  await AsyncStorage.removeItem(SYNC_CONSENT_KEY).catch(() => undefined);
  await AsyncStorage.removeItem(LEGACY_SYNC_PAUSED_KEY).catch(() => undefined);
}

/**
 * Turn photo sync on, prompting for consent the first time. Resolves false if
 * the user declines the prompt, in which case nothing changes.
 *
 * This is the ONLY way sync comes back after a wipe. It used to be a side
 * effect of pressing Save in the auto-posting settings, which meant a publisher
 * whose sync was off had no way to discover it, no indication anything was
 * wrong, and no obvious action to take — sync stayed off for a week and every
 * scheduled post fell through to a "couldn't prepare your post" push.
 */
export async function enablePhotoSync(): Promise<boolean> {
  // A device carrying the old pause flag has consent but no sync; drop it here
  // so "Turn on" works on the first press rather than the second.
  await AsyncStorage.removeItem(LEGACY_SYNC_PAUSED_KEY).catch(() => undefined);
  return confirmPhotoSync();
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
      'To prepare posts for you — even while the app is closed — your recent photos are uploaded to your private cloud space. Only photos from your configured time window are uploaded, and copies that fall outside it are deleted automatically.',
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
