import { useEffect } from 'react';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';

/**
 * Loops a song's preview clip while `active` and a clip exists. The player is
 * released with the component, so leaving the post preview stops the music.
 * Playback is best-effort: a failed load is silence, never a broken composer.
 */
export function useSongPreview(previewUrl: string | undefined, active: boolean): void {
  const player = useAudioPlayer(null);

  useEffect(() => {
    if (previewUrl == null || !active) return;
    try {
      void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
      player.loop = true;
      player.replace({ uri: previewUrl });
      player.play();
    } catch {
      return;
    }
    return () => {
      try {
        player.pause();
      } catch {
        // player already released
      }
    };
  }, [player, previewUrl, active]);
}
