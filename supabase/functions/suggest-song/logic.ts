// Pure logic for the suggest-song service (issue #54), split out of index.ts
// for unit testing: input sanitization, the Gemini prompt, and response
// normalization. The HTTP/auth/Gemini orchestration stays in index.ts.

export const CANDIDATE_COUNT = 5;
export const MAX_LIST = 30; // cap on exclude/seeds lists — guards the prompt size
export const MAX_PHOTOS = 3; // inline images per request — guards worker memory

export interface TrackRef {
  title: string;
  artist: string;
}

export interface PhotoInput {
  base64: string;
  mimeType: string;
}

export interface SongCandidate extends TrackRef {
  reason: string;
}

export function sanitizeTracks(value: unknown): TrackRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t != null)
    .map((t) => ({
      title: typeof t.title === 'string' ? t.title.trim() : '',
      artist: typeof t.artist === 'string' ? t.artist.trim() : '',
    }))
    .filter((t) => t.title !== '' && t.artist !== '')
    .slice(0, MAX_LIST);
}

export function sanitizePhotos(value: unknown): PhotoInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p != null)
    .map((p) => ({
      base64: typeof p.base64 === 'string' ? p.base64 : '',
      mimeType: typeof p.mimeType === 'string' && p.mimeType.startsWith('image/') ? p.mimeType : 'image/jpeg',
    }))
    .filter((p) => p.base64 !== '')
    .slice(0, MAX_PHOTOS);
}

export function buildPrompt(input: {
  place?: string;
  month?: string;
  photoCount?: number;
  photoAttached: boolean;
  exclude: TrackRef[];
  seeds: TrackRef[];
}): string {
  const lines: string[] = [
    'You pick a soundtrack for a photo post in a "share my travels with friends" app.',
    `Suggest ${CANDIDATE_COUNT} real, findable songs (no made-up tracks, no obscure remixes) that fit the post.`,
    'Favor widely loved songs a music service search will definitely find. Vary the artists.',
  ];
  if (input.photoAttached) {
    lines.push(
      '',
      "The post's photos are attached. Look at them and match the song to what is actually IN them —",
      'the mood, scenery, light, and energy (a calm beach sunset wants something different from a night out).',
      'The photos outrank every other signal below.',
    );
  }
  lines.push('', 'The post:');
  if (input.place) lines.push(`- Taken in: ${input.place}`);
  if (input.month) lines.push(`- Time of year: ${input.month}`);
  if (input.photoCount) lines.push(`- ${input.photoCount} photo${input.photoCount === 1 ? '' : 's'}`);
  if (!input.place && !input.month && !input.photoAttached) {
    lines.push('- No context known — suggest feel-good, widely loved travel/memories songs.');
  }
  if (input.place) {
    lines.push('', 'Mix it up: some suggestions may nod to the place or its music scene, others should just match the mood — do NOT make every pick a literal on-the-nose location reference.');
  }
  if (input.seeds.length > 0) {
    lines.push('', "The publisher's recently played songs — match their taste. Prefer suggesting these exact songs when one fits the photos, otherwise songs clearly similar in style:");
    for (const t of input.seeds) lines.push(`- "${t.title}" by ${t.artist}`);
  }
  if (input.exclude.length > 0) {
    lines.push('', 'Already suggested — do NOT repeat these (nor other songs by mostly the same artists):');
    for (const t of input.exclude) lines.push(`- "${t.title}" by ${t.artist}`);
  }
  lines.push('', 'For each song give a one-line reason (max ~10 words) a friend would say.');
  return lines.join('\n');
}

/** Normalizes Gemini's parsed JSON into clean candidates (drops malformed entries, caps the count). */
export function normalizeCandidates(value: unknown): SongCandidate[] {
  return (Array.isArray(value) ? value : [])
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c != null)
    .map((c) => ({
      title: typeof c.title === 'string' ? c.title.trim() : '',
      artist: typeof c.artist === 'string' ? c.artist.trim() : '',
      reason: typeof c.reason === 'string' ? c.reason.trim() : '',
    }))
    .filter((c) => c.title !== '' && c.artist !== '')
    .slice(0, CANDIDATE_COUNT);
}
