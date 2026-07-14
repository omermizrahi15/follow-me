import type { IMusicCatalog, ISongSuggester, SongSuggestionContext } from '../../domain/interfaces';
import type { Song } from '../../domain/entities/Song';

interface Candidate {
  title: string;
  artist: string;
}

/** A downsized photo ready to inline into the suggestion request. */
export interface SuggestionPhoto {
  base64: string;
  mimeType: string;
}

/**
 * Reads + downsizes a local photo for the suggestion request. Null skips the
 * photo (unreadable uri) — in React Native, inject an expo-backed reader.
 */
export type ReadSuggestionPhoto = (uri: string) => Promise<SuggestionPhoto | null>;

/** Photos inlined per request — the strongest signal, but each costs upload size. */
const MAX_PHOTOS = 3;

/**
 * ISongSuggester backed by the `suggest-song` Edge Function (Gemini) — issue #54.
 * Up to MAX_PHOTOS of the posting's photos ride along (downsized base64) so the
 * model picks a song matching what's actually in them. The function returns
 * title/artist candidates; each is resolved against the music catalog for
 * artwork + a 30s preview, so a hallucinated track degrades to a bare
 * title/artist (still postable) instead of a broken player.
 *
 * Null (never a throw) when unconfigured or the call fails — the picker then
 * simply offers manual search only.
 */
export class EdgeFunctionSongSuggester implements ISongSuggester {
  constructor(
    private readonly functionUrl: string,
    private readonly authKey: string,
    private readonly catalog: IMusicCatalog,
    /** Supplies the signed-in user's JWT (the function rejects the bare anon key). */
    private readonly getAccessToken?: () => Promise<string | null>,
    private readonly readPhoto?: ReadSuggestionPhoto,
  ) {}

  async suggest(context: SongSuggestionContext): Promise<Song[] | null> {
    if (this.functionUrl === '') return null;
    try {
      const token = (await this.getAccessToken?.()) ?? this.authKey;
      const photos = await this.resolvePhotos(context.photoUris ?? []);
      const response = await fetch(this.functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: this.authKey,
        },
        body: JSON.stringify({
          ...(context.place != null ? { place: context.place } : {}),
          ...(context.photoCount != null ? { photoCount: context.photoCount } : {}),
          ...(photos.length > 0 ? { photos } : {}),
          month: new Date().toLocaleDateString('en-US', { month: 'long' }),
          ...(context.exclude != null && context.exclude.length > 0
            ? { exclude: context.exclude.map(s => ({ title: s.title, artist: s.artist })) }
            : {}),
        }),
      });
      if (!response.ok) {
        if (__DEV__) console.warn(`[music] suggest-song HTTP ${response.status}`);
        return null;
      }
      const data = (await response.json()) as { candidates?: Candidate[] };
      const candidates = (data.candidates ?? []).filter(
        c => typeof c.title === 'string' && c.title !== '' && typeof c.artist === 'string' && c.artist !== '',
      );
      return await Promise.all(candidates.map(c => this.resolve(c)));
    } catch (e) {
      if (__DEV__) console.warn('[music] suggest-song failed:', e instanceof Error ? e.message : e);
      return null;
    }
  }

  /** Best catalog hit for the candidate; the bare candidate when nothing matches. */
  private async resolve(candidate: Candidate): Promise<Song> {
    const matches = await this.catalog.searchSongs(`${candidate.title} ${candidate.artist}`, 1);
    return matches[0] ?? { title: candidate.title, artist: candidate.artist };
  }

  /**
   * First/middle/last of the batch (spread beats first-3 for a day of photos),
   * read + downsized. Unreadable photos are skipped, never fatal.
   */
  private async resolvePhotos(uris: string[]): Promise<SuggestionPhoto[]> {
    const readPhoto = this.readPhoto;
    if (readPhoto == null || uris.length === 0) return [];
    const picked = uris.length <= MAX_PHOTOS
      ? uris
      : [uris[0], uris[Math.floor(uris.length / 2)], uris[uris.length - 1]] as string[];
    const photos = await Promise.all(
      picked.map(async uri => {
        try {
          return await readPhoto(uri);
        } catch {
          return null;
        }
      }),
    );
    return photos.filter((p): p is SuggestionPhoto => p != null);
  }
}
