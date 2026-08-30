import { InspectGradesUseCase } from './InspectGradesUseCase';
import { PublisherConfig, type PublisherConfigProps } from '../../domain/entities/PublisherConfig';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { IClassificationStore, ISentPhotoTracker } from '../../domain/interfaces';

function grade(id: string, over: Partial<PhotoClassification> = {}): PhotoClassification {
  return {
    candidate: { id, uri: `ph://${id}`, createdAt: new Date(Date.UTC(2026, 7, 1)) },
    category: 'nature',
    confidence: 0.9,
    quality: 0.8,
    caption: 'a photo',
    scene: `scene-${id}`,
    containsPublisher: false,
    publisherConfidence: 0,
    reason: 'sharp and well lit',
    ...over,
  };
}

function config(over: Partial<PublisherConfigProps> = {}): PublisherConfig {
  return PublisherConfig.create({
    publisherId: 'pub-1',
    frequency: 'weekly',
    photosPerPost: 5,
    requireApproval: true,
    enabledCategories: ['sunset_sunrise', 'nature'],
    ...over,
  });
}

function store(grades: PhotoClassification[]): IClassificationStore {
  return {
    load: () => Promise.resolve(new Map()),
    save: () => Promise.resolve(),
    loadAll: () => Promise.resolve(grades),
  };
}

function tracker(sent: string[] = []): ISentPhotoTracker {
  return {
    sentCandidateIds: () => Promise.resolve(new Set(sent)),
    newestPostedPhotoAt: () => Promise.resolve(null),
    markSent: () => Promise.resolve(),
  } as unknown as ISentPhotoTracker;
}

describe('InspectGradesUseCase', () => {
  it('explains every remembered grade, best first', async () => {
    const sut = new InspectGradesUseCase(store([
      grade('low', { quality: 0.2 }),
      grade('high', { quality: 0.95 }),
    ]), tracker());

    const result = await sut.execute(config());

    expect(result.photos.map(p => p.facts.id)).toEqual(['high', 'low']);
    expect(result.photos[0]?.rank).toBe(1);
    // The reason travels with the grade — it is half of what the screen exists
    // to show, and the numbers alone are what nobody could argue with.
    expect(result.photos[0]?.item.reason).toBe('sharp and well lit');
  });

  it('marks the photos that would go in the next post', async () => {
    const sut = new InspectGradesUseCase(
      store([grade('a', { quality: 0.9 }), grade('b', { quality: 0.8 }), grade('c', { quality: 0.1 })]),
      tracker(),
    );

    // The floor is what leaves 'c' out here — with room for five and only
    // three photos, nothing else would.
    const result = await sut.execute(config({ minQuality: 0.5 }));

    expect(result.photos.filter(p => p.inBatch).map(p => p.facts.id)).toEqual(['a', 'b']);
  });

  it('reports a photo already posted as such rather than silently dropping it', async () => {
    // The scan removes already-sent photos before ranking, which is right for a
    // post and useless for debugging: "where did that photo go" is exactly the
    // question this screen answers.
    const sut = new InspectGradesUseCase(store([grade('sent'), grade('fresh')]), tracker(['sent']));

    const result = await sut.execute(config());

    expect(result.photos.map(p => p.facts.id).sort()).toEqual(['fresh', 'sent']);
    expect(result.photos.find(p => p.facts.id === 'sent')?.blockers.map(b => b.key))
      .toEqual(['already-sent']);
  });

  it('summarises the set so the headline numbers are not counted by the screen', async () => {
    const sut = new InspectGradesUseCase(
      store([
        grade('a', { quality: 0.9 }),
        grade('b', { category: 'food', quality: 0.9 }),
        grade('c', { quality: 0.05 }),
      ]),
      tracker(),
    );

    const result = await sut.execute(config({ minQuality: 0.1 }));

    expect(result.summary).toEqual({
      graded: 3,
      eligible: 1,
      blocked: 2,
      inBatch: 1,
      averageQuality: 0.62,
    });
  });

  it('has nothing to explain when nothing has been graded', async () => {
    const result = await new InspectGradesUseCase(store([]), tracker()).execute(config());

    expect(result.photos).toEqual([]);
    expect(result.summary.graded).toBe(0);
    expect(result.summary.averageQuality).toBe(0);
  });

  it('reads grades under the face the config actually asks about', async () => {
    // A grade bought without a reference says containsPublisher: false because
    // nobody asked. Ranking under "photos of me" against those grades would
    // report every photo as one the publisher is not in.
    const keys: (string | undefined)[] = [];
    const spy: IClassificationStore = {
      load: () => Promise.resolve(new Map()),
      save: () => Promise.resolve(),
      loadAll: (key?: string) => { keys.push(key); return Promise.resolve([]); },
    };

    await new InspectGradesUseCase(spy, tracker(), () => Promise.resolve('https://avatar/1.jpg'))
      .execute(config({ photosOfMe: 'prefer' }));

    expect(keys).toEqual(['https://avatar/1.jpg']);
  });

  it('asks about no face at all when the preference is off', async () => {
    const keys: (string | undefined)[] = [];
    const spy: IClassificationStore = {
      load: () => Promise.resolve(new Map()),
      save: () => Promise.resolve(),
      loadAll: (key?: string) => { keys.push(key); return Promise.resolve([]); },
    };

    await new InspectGradesUseCase(spy, tracker(), () => Promise.resolve('https://avatar/1.jpg'))
      .execute(config());

    expect(keys).toEqual(['']);
  });
});
