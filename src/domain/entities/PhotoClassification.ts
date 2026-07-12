import type { PhotoCandidate } from './PhotoCandidate';

/**
 * The 8 scene categories a photo can fall into, ordered from most to least
 * desirable for a travel/lifestyle share. `other` is a catch-all for anything
 * that doesn't fit (screenshots, receipts, blurry shots) and is always excluded.
 */
export type PhotoCategory =
  | 'selfie_with_view'    // You in frame with scenic background
  | 'sunset_sunrise'      // Golden-hour / sunrise / sunset sky
  | 'architecture'        // Buildings, streets, urban scenes
  | 'selfie_with_people'  // Group/people photos, no notable scenery
  | 'food'                // Food & drinks
  | 'nature'              // Wildlife, plants, natural scenes (no selfie)
  | 'night_scene'         // Night photography, city lights after dark
  | 'cultural'            // Museums, art, historical, religious sites
  | 'other';

/** Every category the publisher is allowed to enable (excludes `other`). */
export const SELECTABLE_CATEGORIES: readonly PhotoCategory[] = [
  'selfie_with_view',
  'sunset_sunrise',
  'architecture',
  'selfie_with_people',
  'food',
  'nature',
  'night_scene',
  'cultural',
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
  /**
   * 2-4 word slug identifying the unique scene or subject, e.g. "beach-sunset",
   * "restaurant-dinner", "hiking-summit". Photos of the same moment / place
   * should share the same slug so the selection service can deduplicate them.
   */
  scene: string;
}
