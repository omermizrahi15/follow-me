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
  createdAt: number; // epoch ms
  /**
   * Whether the publisher is in the photo (issue #137). Optional because this
   * cache is also filled from the approval push payload, which older server
   * deployments send without it — and because a suggestion cached before #137
   * must still load. Absent reads as false, the same "nobody asked" the
   * selection rules treat it as.
   */
  containsPublisher?: boolean;
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
    containsPublisher: p.containsPublisher ?? false,
    // The match confidence is deliberately not cached: nothing reads it back,
    // and a cached suggestion is already a decided batch rather than something
    // that gets re-ranked.
    publisherConfidence: 0,
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
    createdAt: c.candidate.createdAt.getTime(),
    containsPublisher: c.containsPublisher,
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
