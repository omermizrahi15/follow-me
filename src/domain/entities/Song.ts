/**
 * A song optionally attached to a posting (issue #54). Stored as jsonb on the
 * media rows (app feed) and the posts row (web gallery), so both viewers can
 * show the same music bar.
 */
export interface Song {
  title: string;
  artist: string;
  /** Square cover art. */
  artworkUrl?: string;
  /** ~30-second audio preview (m4a/mp3) playable in the app and web gallery. */
  previewUrl?: string;
  /** Public page for the full track (e.g. Apple Music). */
  sourceUrl?: string;
}

/**
 * Validates an untrusted value (jsonb column, function response) into a Song.
 * Title and artist are required; malformed optional fields are dropped rather
 * than failing the whole song. Null when the value isn't a song at all.
 */
export function parseSong(value: unknown): Song | null {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const artist = typeof record.artist === 'string' ? record.artist.trim() : '';
  if (title === '' || artist === '') return null;
  const optional = (key: 'artworkUrl' | 'previewUrl' | 'sourceUrl'): { [k: string]: string } | null => {
    const value = record[key];
    return typeof value === 'string' && value !== '' ? { [key]: value } : null;
  };
  return {
    title,
    artist,
    ...optional('artworkUrl'),
    ...optional('previewUrl'),
    ...optional('sourceUrl'),
  };
}
