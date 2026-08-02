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
    await AsyncStorage.setItem('photo_grades:v1', 'not json');

    await expect(ClassificationCache.load(['a'])).resolves.toEqual(new Map());
    await expect(ClassificationCache.save([grade('a')])).resolves.toBeUndefined();
  });

  it('does not touch storage when there is nothing to save', async () => {
    const spy = jest.spyOn(AsyncStorage, 'setItem');
    spy.mockClear(); // earlier tests in this file share the module-level mock

    await ClassificationCache.save([]);

    expect(spy).not.toHaveBeenCalled();
  });
});
