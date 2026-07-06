import { Share } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { useAuth } from '../context/AuthContext';
import { useProfile } from './useProfile';

// Public subscribe page (GitHub Pages); the publisher id travels as the `?p=` param.
const JOIN_BASE_URL = 'https://omermizrahi15.github.io/follow-me/join/';

/**
 * Single source of truth for the publisher's shareable join link and the
 * WhatsApp invite message. Reused by the Me page, the Followers section,
 * onboarding, and the post-share prompt so the URL and copy never drift.
 */
export function buildJoinLink(publisherId: string): string {
  return `${JOIN_BASE_URL}?p=${publisherId}`;
}

export function buildInviteMessage(joinLink: string): string {
  return `Follow me on Follow Me! You'll receive my photos on WhatsApp: ${joinLink}`;
}

interface InviteLink {
  /** The publisher's join link, or null when not signed in yet. */
  joinLink: string | null;
  /** Opens the native share sheet with the invite message. No-op when signed out. */
  shareInvite: () => void;
}

// Downloads the avatar into the cache so the share sheet can attach it as an
// image (share targets need a local file, not a remote URL). Null on failure —
// the invite then goes out as text-only rather than not at all.
async function downloadAvatar(url: string): Promise<string | null> {
  try {
    const file = await File.downloadFileAsync(url, new Directory(Paths.cache), {
      idempotent: true,
    });
    return file.uri;
  } catch {
    return null;
  }
}

export function useInviteLink(): InviteLink {
  const { publisherId } = useAuth();
  const { profile } = useProfile(publisherId);
  const joinLink = publisherId != null ? buildJoinLink(publisherId) : null;

  function shareInvite(): void {
    if (joinLink == null) return;
    void (async (): Promise<void> => {
      const message = buildInviteMessage(joinLink);
      // With a profile photo, share it alongside the message — WhatsApp sends
      // the photo with the invite text as its caption, so followers see who
      // is inviting them. Just the photo; the bio stays out of the invite.
      const avatarUri = profile?.avatarUrl != null ? await downloadAvatar(profile.avatarUrl) : null;
      try {
        await Share.share(avatarUri != null ? { message, url: avatarUri } : { message });
      } catch {
        // Share sheet dismissed or unavailable — nothing to recover.
      }
    })();
  }

  return { joinLink, shareInvite };
}
