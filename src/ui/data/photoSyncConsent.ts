import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** One-time consent flag for uploading recent photos to the cloud. */
const SYNC_CONSENT_KEY = 'photo-sync-consent-v1';

/** Whether the user has already consented to photo upload. Never prompts. */
export async function hasPhotoSyncConsent(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(SYNC_CONSENT_KEY).catch(() => null);
  return stored != null;
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
