import type { IMusicCatalog } from '../../domain/interfaces';
import type { Song } from '../../domain/entities/Song';

interface ITunesTrack {
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackViewUrl?: string;
}

/** Song search is a nice-to-have on the compose path — give up quickly. */
const TIMEOUT_MS = 8000;
const DEFAULT_LIMIT = 10;

/**
 * Song search via the iTunes Search API — keyless and client-callable, and the
 * only major catalog still serving free ~30s previews (Spotify removed preview
 * URLs for new apps in 2024). Returns songs with preview + artwork ready for
 * playback in the picker, the app gallery, and the web gallery. Never throws:
 * a failed search shows as "no results", not a broken compose flow.
 */
export class ITunesMusicCatalog implements IMusicCatalog {
  async searchSongs(term: string, limit: number = DEFAULT_LIMIT): Promise<Song[]> {
    const trimmed = term.trim();
    if (trimmed === '') return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://itunes.apple.com/search?media=music&entity=song&limit=${limit}&term=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        if (__DEV__) console.warn(`[music] iTunes search HTTP ${response.status}`);
        return [];
      }
      const data = (await response.json()) as { results?: ITunesTrack[] };
      return (data.results ?? [])
        .map(toSong)
        .filter((s): s is Song => s != null);
    } catch (e) {
      if (__DEV__) console.warn('[music] iTunes search failed:', e instanceof Error ? e.message : e);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

function toSong(track: ITunesTrack): Song | null {
  const title = track.trackName?.trim() ?? '';
  const artist = track.artistName?.trim() ?? '';
  if (title === '' || artist === '') return null;
  return {
    title,
    artist,
    ...(track.artworkUrl100 != null ? { artworkUrl: displayArtwork(track.artworkUrl100) } : {}),
    ...(track.previewUrl != null ? { previewUrl: track.previewUrl } : {}),
    ...(track.trackViewUrl != null ? { sourceUrl: track.trackViewUrl } : {}),
  };
}

/** iTunes serves any square size by URL convention — 100px thumbs pixelate in the music bar. */
function displayArtwork(artworkUrl100: string): string {
  return artworkUrl100.replace('100x100bb', '600x600bb');
}
