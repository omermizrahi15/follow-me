import { Alert } from 'react-native';
import { deleteAccount } from '../../composition/container';
import { alertFailure, refuseIfOffline } from './writeGuard';

/**
 * Deletes the account on the server, then ends the local session.
 *
 * The order is the point: if the server could not finish (it deletes its data,
 * then the login, and can fail part-way) the user must still be signed in so
 * they can press the button again. Once the account is gone, a failing local
 * sign-out is harmless — there is no session left to revoke — so it is
 * swallowed rather than reported as a failed deletion.
 */
export async function deleteAccountAndSignOut(signOut: () => Promise<void>): Promise<void> {
  await deleteAccount();
  try {
    await signOut();
  } catch {
    // The account no longer exists; nothing left to sign out of.
  }
}

/**
 * "Delete my account" — Settings. App Store guideline 5.1.1(v) requires that an
 * app which creates accounts can delete them without leaving the app.
 */
export function confirmAccountDeletion(signOut: () => Promise<void>): void {
  if (refuseIfOffline('Deleting your account')) return;
  Alert.alert(
    'Delete your account?',
    'This permanently deletes your profile, posts, uploaded photos, settings and follower list. Messages already sent to followers on WhatsApp stay on their phones and can’t be recalled. This can’t be undone.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete account',
        style: 'destructive',
        onPress: () => {
          void deleteAccountAndSignOut(signOut).catch((e: unknown) =>
            alertFailure(e, 'Couldn’t delete your account'),
          );
        },
      },
    ],
  );
}
