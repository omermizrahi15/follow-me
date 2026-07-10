// Pure classification helpers for classify-photos, split out of index.ts for
// unit testing: the category set, score/category normalization, base64 encoding,
// and defensive parsing of the model's JSON response.

export const CATEGORIES = [
  'selfie_with_view',
  'sunset_sunrise',
  'view_only',
  'architecture',
  'selfie_with_people',
  'food',
  'nature',
  'night_scene',
  'activity',
  'cultural',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Classification {
  id: string;
  category: Category;
  confidence: number;
  quality: number;
  caption: string;
  scene: string;
}

/** btoa over arbitrary bytes, chunked to avoid the argument-count limit on large images. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Coerce anything to a 0..1 score; non-finite input becomes 0. */
export function clamp01(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** Map an arbitrary value to a known Category, defaulting unknowns to 'other'. */
export function normalizeCategory(c: unknown): Category {
  return CATEGORIES.includes(c as Category) ? (c as Category) : 'other';
}

/** Turn the model's parsed JSON into a safe Classification (bad/missing fields defaulted). */
export function parseClassification(id: string, parsed: Record<string, unknown>): Classification {
  return {
    id,
    category: normalizeCategory(parsed.category),
    confidence: clamp01(parsed.confidence),
    quality: clamp01(parsed.quality),
    caption: typeof parsed.caption === 'string' ? parsed.caption : '',
    scene: typeof parsed.scene === 'string' ? parsed.scene.toLowerCase().trim() : '',
  };
}
