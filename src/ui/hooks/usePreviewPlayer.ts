import { useEffect, useState } from 'react';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

interface PreviewPlayer {
  /** Preview URL currently playing, or null when idle. */
  playingUrl: string | null;
  /** Play the url (stopping anything else), or pause it if already playing. */
  toggle: (url: string) => void;
  stop: () => void;
}

/**
 * One shared 30s-preview player for a screen: whichever song is toggled plays,
 * anything previously playing stops (issue #54). The player is released
 * automatically when the owning component unmounts.
 */
export function usePreviewPlayer(): PreviewPlayer {
  const player = useAudioPlayer();
  const status = useAudioPlayerStatus(player);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);

  // Previews must be audible with the iOS mute switch on — with the default
  // audio mode the player "plays" silently and the button looks broken.
  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  // Reflect natural end-of-preview back into the button state.
  useEffect(() => {
    if (status.didJustFinish) setPlayingUrl(null);
  }, [status.didJustFinish]);

  function toggle(url: string): void {
    if (playingUrl === url) {
      player.pause();
      setPlayingUrl(null);
      return;
    }
    player.replace({ uri: url });
    player.play();
    setPlayingUrl(url);
  }

  function stop(): void {
    if (playingUrl != null) player.pause();
    setPlayingUrl(null);
  }

  return { playingUrl, toggle, stop };
}
