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

/** Suspend background auto-sync — called right after the cloud wipe succeeds. */
export async function pausePhotoSync(): Promise<void> {
  await AsyncStorage.setItem(SYNC_PAUSED_KEY, new Date().toISOString()).catch(() => undefined);
}

/** Resume background auto-sync — called when the user next saves their settings. */
export async function resumePhotoSync(): Promise<void> {
  await AsyncStorage.removeItem(SYNC_PAUSED_KEY).catch(() => undefined);
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
