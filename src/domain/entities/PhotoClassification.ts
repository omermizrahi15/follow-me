import type { PhotoCandidate } from './PhotoCandidate';

/**
 * The rule buckets a photo can fall into. `other` is a catch-all for anything
 * that doesn't match a real rule (screenshots, receipts, blurry shots) and is
 * always excluded from suggestions.
 */
export type PhotoCategory =
  | 'selfie_with_view'
  | 'selfie_with_people'
  | 'view_only'
  | 'food'
  | 'other';

/** Every category the publisher is allowed to opt into (excludes `other`). */
export const SELECTABLE_CATEGORIES: readonly PhotoCategory[] = [
  'selfie_with_view',
  'selfie_with_people',
  'view_only',
  'food',
] as const;

/**
 * The AI's verdict on a single candidate photo. Produced by an IPhotoClassifier
 * adapter and consumed by the pure PhotoSelectionService.
 */
export interface PhotoClassification {
  candidate: PhotoCandidate;
  category: PhotoCategory;
  /** Model confidence in the category, 0..1. */
  confidence: number;
  /** Aesthetic/technical quality (sharpness, exposure, composition), 0..1. */
  quality: number;
  /** Short human-readable caption for the photo. */
  caption: string;
}
