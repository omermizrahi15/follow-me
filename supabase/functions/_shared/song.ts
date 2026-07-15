// The posting's soundtrack (issue #54) — stored on the posts row and rendered
// as a music bar by the web gallery. Kept env-free so request-validation
// logic.ts files can import it under the test runner.

export interface PostSong {
  title: string;
  artist: string;
  artworkUrl?: string;
  previewUrl?: string;
  sourceUrl?: string;
}

/**
 * Validates an untrusted request-body song. Title and artist are required;
 * optional fields must be https URLs (they end up in a public page). Null when
 * the value isn't usable — a bad song never blocks the send.
 */
export function sanitizeSong(value: unknown): PostSong | null {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim().slice(0, 200) : '';
  const artist = typeof record.artist === 'string' ? record.artist.trim().slice(0, 200) : '';
  if (title === '' || artist === '') return null;
  const url = (key: 'artworkUrl' | 'previewUrl' | 'sourceUrl'): { [k: string]: string } | null => {
    const v = record[key];
    return typeof v === 'string' && v.startsWith('https://') ? { [key]: v } : null;
  };
  return { title, artist, ...url('artworkUrl'), ...url('previewUrl'), ...url('sourceUrl') };
}
