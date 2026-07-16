import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PhotoCategory } from '../../domain/entities/PhotoClassification';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';

/** Shape of a single photo inside the push notification payload / cache. */
export interface CachedPhoto {
  id: string;
  url: string;
  category: PhotoCategory;
  caption: string;
  quality: number;
  scene: string;
  /** AI's best-guess place name — absent in caches/pushes from older versions. */
  place?: string;
  createdAt: number; // epoch ms
}

export interface CachedSuggestion {
  publisherId: string;
  batch: CachedPhoto[];
  pool: CachedPhoto[];
  batchId: string;
  cachedAt: number; // epoch ms
}

/** TTL before a cached suggestion is discarded (slightly beyond monthly frequency). */
const CACHE_TTL_MS = 32 * 24 * 60 * 60 * 1000;

function storageKey(publisherId: string): string {
  return `suggestion_cache:${publisherId}`;
}

export function cachedPhotoToClassification(p: CachedPhoto): PhotoClassification {
  return {
    candidate: { id: p.id, uri: p.url, createdAt: new Date(p.createdAt) },
    category: p.category,
    confidence: 1,
    quality: p.quality,
    caption: p.caption,
    scene: p.scene,
    place: p.place ?? '',
  };
}

/** Inverse of cachedPhotoToClassification — used to persist an on-device scan result. */
export function classificationToCachedPhoto(c: PhotoClassification): CachedPhoto {
  return {
    id: c.candidate.id,
    url: c.candidate.uri,
    category: c.category,
    caption: c.caption,
    quality: c.quality,
    scene: c.scene,
    place: c.place ?? '',
    createdAt: c.candidate.createdAt.getTime(),
  };
}

export const SuggestionCache = {
  async save(suggestion: CachedSuggestion): Promise<void> {
    await AsyncStorage.setItem(storageKey(suggestion.publisherId), JSON.stringify(suggestion));
  },

  async load(publisherId: string): Promise<CachedSuggestion | null> {
    try {
      const raw = await AsyncStorage.getItem(storageKey(publisherId));
      if (raw == null) return null;
      const parsed = JSON.parse(raw) as CachedSuggestion;
      if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) {
        void AsyncStorage.removeItem(storageKey(publisherId));
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },

  async clear(publisherId: string): Promise<void> {
    await AsyncStorage.removeItem(storageKey(publisherId));
  },
};
