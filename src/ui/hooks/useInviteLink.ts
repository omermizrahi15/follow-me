import { Share } from 'react-native';
import { useAuth } from '../context/AuthContext';

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

export function useInviteLink(): InviteLink {
  const { publisherId } = useAuth();
  const joinLink = publisherId != null ? buildJoinLink(publisherId) : null;

  function shareInvite(): void {
    if (joinLink == null) return;
    void Share.share({ message: buildInviteMessage(joinLink) });
  }

  return { joinLink, shareInvite };
}
