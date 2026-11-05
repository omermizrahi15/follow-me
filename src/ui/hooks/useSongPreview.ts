import { useEffect } from 'react';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { previewVolume } from '../../domain/services/previewFade';

/** How often the fade is re-applied; short enough to sound smooth. */
const FADE_TICK_MS = 100;

/**
 * Loops a song's preview clip, fading at the loop point, while `active` and a clip exists. The player is
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
    const fade = setInterval(() => {
      try {
        player.volume = previewVolume(player.currentTime, player.duration);
      } catch {
        // player already released
      }
    }, FADE_TICK_MS);
    return () => {
      clearInterval(fade);
      try {
        player.pause();
      } catch {
        // player already released
      }
    };
  }, [player, previewUrl, active]);
}
