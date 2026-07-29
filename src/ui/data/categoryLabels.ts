import type { PhotoCategory } from '../../domain/entities/PhotoClassification';

/**
 * How each AI category is written in the UI. Shared so the history preview and
 * the live review screen label a photo identically — the same shot described
 * two different ways in two places reads as two different judgements.
 */
export const CATEGORY_LABEL: Record<PhotoCategory, string> = {
  selfie_with_view: 'People + view',
  sunset_sunrise: 'Sunset / sunrise',
  architecture: 'Architecture',
  selfie_with_people: 'People',
  food: 'Food',
  nature: 'Nature',
  night_scene: 'Night scene',
  cultural: 'Cultural',
  other: 'Other',
};
