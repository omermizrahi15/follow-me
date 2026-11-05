import type { IMusicCatalog } from '../../domain/interfaces';
import type { Song } from '../../domain/entities/Song';

interface ITunesTrack {
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
}

/**
 * Song search via the iTunes Search API — keyless and callable from the app.
 * Never throws: a failed search reads as "no results", not a broken composer.
 */
export class ITunesMusicCatalog implements IMusicCatalog {
  async searchSongs(term: string): Promise<Song[]> {
    try {
      const res = await fetch(
        `https://itunes.apple.com/search?media=music&entity=song&limit=15&term=${encodeURIComponent(term)}`,
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { results?: ITunesTrack[] };
      return (data.results ?? []).flatMap(t =>
        t.trackName && t.artistName
          ? [{
              title: t.trackName,
              artist: t.artistName,
              ...(t.artworkUrl100 ? { artworkUrl: t.artworkUrl100.replace('100x100bb', '300x300bb') } : {}),
            }]
          : [],
      );
    } catch {
      return [];
    }
  }
}
