import { Alert } from 'react-native';
import { deleteUploadedPhotos } from '../../composition/container';
import { withdrawPhotoSyncConsent } from './photoSyncConsent';
import { syncBlocked } from './syncStatus';
import { alertFailure, refuseIfOffline } from './writeGuard';

/**
 * "Remove my photos from the cloud" — the privacy escape hatch.
 *
 * Routine cleanup is not this: copies that age out of the publisher's window
 * are deleted automatically after every sync (see `candidateSync`). This is the
 * deliberate "delete everything you hold of mine, now", which is why it lives
 * in Settings rather than in the middle of the auto-posting setup, where it
 * read as a chore the publisher was expected to perform.
 *
 * Deleting also withdraws consent. Without that the next foreground would
 * re-upload everything that was just deleted, which made the wipe cosmetic
 * (issue #72). The consequence — nothing can be posted while the app is closed
 * — is stated in the dialog and shown afterwards by PhotoSyncStatus, which
 * carries the one action that turns upload back on.
 */
export function confirmCloudPhotoWipe(onDone?: () => void): void {
  // Server-side delete: asking for it offline can only end in a timeout, and
  // a wipe that half-happened is the last thing this dialog should risk (#145).
  if (refuseIfOffline('Removing your photos from the cloud')) return;
  Alert.alert(
    'Remove your photos from the cloud?',
    'This deletes every private copy the app has uploaded, and stops uploading new ones — so posts can no longer be prepared while the app is closed. Photos on your phone and posts already sent are untouched. You can turn upload back on any time.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async (): Promise<void> => {
            try {
              const { deletedRows } = await deleteUploadedPhotos();
              await withdrawPhotoSyncConsent();
              // Tell the UI now rather than waiting for the next sync attempt to
              // report it: the publisher has just switched upload off and should
              // see that state — and its "Turn on" — immediately.
              syncBlocked('no-consent');
              onDone?.();
              Alert.alert(
                'Deleted',
                `${deletedRows} uploaded photo${deletedRows === 1 ? '' : 's'} removed. Photo upload is now off.`,
              );
            } catch (e: unknown) {
              alertFailure(e, 'Couldn’t remove your photos');
            }
          })();
        },
      },
    ],
  );
}
