// In-memory AsyncStorage — the real one needs a React Native host. Declared
// with a `mock` prefix so jest allows it inside the hoisted factory.
const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
    setItem: jest.fn((k: string, v: string) => { mockStore.set(k, v); return Promise.resolve(); }),
    removeItem: jest.fn((k: string) => { mockStore.delete(k); return Promise.resolve(); }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ClassificationCache, clearClassificationCache } from './ClassificationCache';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';

function grade(id: string, over: Partial<PhotoClassification> = {}): PhotoClassification {
  return {
    candidate: { id, uri: `ph://${id}`, createdAt: new Date('2026-07-01T12:00:00Z') },
    category: 'nature',
    confidence: 0.9,
    quality: 0.8,
    caption: 'a photo',
    scene: 'beach',
    containsPublisher: false,
    publisherConfidence: 0,
    ...over,
  };
}

beforeEach(async () => {
  await clearClassificationCache();
});

describe('ClassificationCache', () => {
  it('returns a saved grade in full, so a hit needs no re-classification', async () => {
    await ClassificationCache.save([grade('a', { quality: 0.42, scene: 'harbour' })]);

    const found = await ClassificationCache.load(['a']);

    const hit = found.get('a');
    expect(hit?.quality).toBe(0.42);
    expect(hit?.scene).toBe('harbour');
    expect(hit?.category).toBe('nature');
    expect(hit?.candidate.id).toBe('a');
    expect(hit?.candidate.uri).toBe('ph://a');
  });

  it('omits photos it has never seen rather than guessing at them', async () => {
    await ClassificationCache.save([grade('a')]);

    const found = await ClassificationCache.load(['a', 'b']);

    expect([...found.keys()]).toEqual(['a']);
  });

  it('keeps grades from earlier saves when a later scan adds more', async () => {
    await ClassificationCache.save([grade('a')]);
    await ClassificationCache.save([grade('b')]);

    const found = await ClassificationCache.load(['a', 'b']);

    expect([...found.keys()].sort()).toEqual(['a', 'b']);
  });

  it('re-grades a photo that is graded again, rather than keeping the stale verdict', async () => {
    await ClassificationCache.save([grade('a', { quality: 0.1 })]);
    await ClassificationCache.save([grade('a', { quality: 0.9 })]);

    expect((await ClassificationCache.load(['a'])).get('a')?.quality).toBe(0.9);
  });

  // A scan the publisher is waiting on must not fail because storage did.
  it('degrades to a miss when the stored blob is unreadable', async () => {
    await AsyncStorage.setItem('photo_grades:v2', 'not json');

    await expect(ClassificationCache.load(['a'])).resolves.toEqual(new Map());
    await expect(ClassificationCache.save([grade('a')])).resolves.toBeUndefined();
  });

  it('does not touch storage when there is nothing to save', async () => {
    const spy = jest.spyOn(AsyncStorage, 'setItem');
    spy.mockClear(); // earlier tests in this file share the module-level mock

    await ClassificationCache.save([]);

    expect(spy).not.toHaveBeenCalled();
  });

  describe('face reference (issue #137)', () => {
    const AVATAR = 'https://cdn.test/avatar.jpg';

    it('remembers whether the publisher was in the photo', async () => {
      await ClassificationCache.save([grade('a', { containsPublisher: true })], AVATAR);

      const hit = (await ClassificationCache.load(['a'], AVATAR)).get('a');
      expect(hit?.containsPublisher).toBe(true);
    });

    it('misses a grade bought without the face being looked for', async () => {
      // The whole point: this grade's `containsPublisher: false` means "nobody
      // asked", and serving it under `prefer`/`only` would sink or hide exactly
      // the photos the publisher turned the setting on for. Re-grade instead.
      await ClassificationCache.save([grade('a')]);

      expect(await ClassificationCache.load(['a'], AVATAR)).toEqual(new Map());
    });

    it('misses a grade bought against a different profile photo', async () => {
      await ClassificationCache.save([grade('a', { containsPublisher: true })], AVATAR);

      expect(await ClassificationCache.load(['a'], 'https://cdn.test/new-avatar.jpg')).toEqual(
        new Map(),
      );
    });

    it('hits any grade when the caller is not asking about a face', async () => {
      // Turning the preference back off must cost nothing — every grade is
      // still a valid answer to "what is this photo and how good is it".
      await ClassificationCache.save([grade('a', { containsPublisher: true })], AVATAR);

      expect((await ClassificationCache.load(['a'])).get('a')?.quality).toBe(0.8);
    });

    it('reads a pre-#137 entry, which knows no face, as not containing the publisher', async () => {
      await AsyncStorage.setItem(
        'photo_grades:v2',
        JSON.stringify({
          a: {
            uri: 'ph://a', createdAt: 0, category: 'nature', confidence: 0.9,
            quality: 0.8, caption: '', scene: 'beach', gradedAt: Date.now(),
          },
        }),
      );

      const hit = (await ClassificationCache.load(['a'])).get('a');
      expect(hit?.containsPublisher).toBe(false);
      expect(hit?.publisherConfidence).toBe(0);
    });
  });
});
