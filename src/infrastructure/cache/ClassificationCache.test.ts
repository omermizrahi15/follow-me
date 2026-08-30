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
    reason: '',
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

describe('ClassificationCache — the model’s account of a grade', () => {
  it('remembers why a photo was graded the way it was', async () => {
    // Without this, the reason survives exactly one scan: every photo the
    // publisher looks at later is one answered from cache, so the grade
    // inspector would have numbers for every photo and an explanation for none.
    await ClassificationCache.save([
      {
        candidate: { id: 'a', uri: 'file://a', createdAt: new Date(1_000) },
        category: 'food',
        confidence: 0.9,
        quality: 0.4,
        caption: 'Dinner',
        scene: 'restaurant-dinner',
        containsPublisher: false,
        publisherConfidence: 0,
        reason: 'Underexposed and the plate is cropped.',
      },
    ]);

    const loaded = await ClassificationCache.load(['a']);
    expect(loaded.get('a')?.reason).toBe('Underexposed and the plate is cropped.');
  });

  it('reads a grade stored before reasons existed as having none', async () => {
    // v2 entries are genuine grades and must keep working; an absent reason is
    // an absent reason, not a defect worth re-buying the grade over.
    await AsyncStorage.setItem(
      'photo_grades:v2',
      JSON.stringify({
        old: {
          uri: 'file://old',
          createdAt: 1_000,
          category: 'nature',
          confidence: 1,
          quality: 0.7,
          caption: 'Trees',
          scene: 'forest',
          gradedAt: Date.now(),
        },
      }),
    );

    const loaded = await ClassificationCache.load(['old']);
    expect(loaded.get('old')?.reason).toBe('');
  });
});

describe('ClassificationCache.loadAll', () => {
  it('hands back every remembered grade, newest first', async () => {
    // The grade inspector has no id list to ask with — its whole question is
    // "what does the AI think of everything it has looked at", which nothing
    // could answer while the only read was keyed by asset id.
    await ClassificationCache.save([
      grade('old', { candidate: { id: 'old', uri: 'ph://old', createdAt: new Date(1_000) } }),
      grade('new', { candidate: { id: 'new', uri: 'ph://new', createdAt: new Date(9_000) } }),
    ]);

    const all = await ClassificationCache.loadAll();

    expect(all.map(c => c.candidate.id)).toEqual(['new', 'old']);
  });

  it('honours the same face key that load does', async () => {
    // A grade bought without looking for a face says containsPublisher: false
    // for the trivial reason that nobody asked. Serving it under a face key
    // would rank photos of the publisher as though they were not in them —
    // the same trap load avoids, and the inspector must not reintroduce it.
    await ClassificationCache.save([grade('a')], 'https://avatar/1.jpg');
    await ClassificationCache.save([grade('b')], '');

    expect((await ClassificationCache.loadAll('https://avatar/1.jpg')).map(c => c.candidate.id))
      .toEqual(['a']);
    // An empty key is "not asking", and every grade qualifies.
    expect((await ClassificationCache.loadAll('')).map(c => c.candidate.id).sort())
      .toEqual(['a', 'b']);
  });

  it('is empty when nothing has been graded', async () => {
    expect(await ClassificationCache.loadAll()).toEqual([]);
  });
});
