import { SuggestPhotosUseCase } from './SuggestPhotosUseCase';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import {
  FakeMediaLibrary,
  FakePhotoClassifier,
  FakeSentPhotoTracker,
} from '../../test-support/fakes';

// Give candidates distinct timestamps (1 day apart) so temporal dedup in
// PhotoSelectionService doesn't treat them as the same event.
let candidateSeq = 0;
function candidate(id: string): PhotoCandidate {
  const day = candidateSeq++;
  return { id, uri: `https://cdn.test/${id}.jpg`, createdAt: new Date(Date.UTC(2026, 5, 1 + day)) };
}

beforeEach(() => { candidateSeq = 0; });

function classification(id: string, over: Partial<PhotoClassification> = {}): PhotoClassification {
  return {
    candidate: candidate(id),
    category: 'nature',
    confidence: 0.9,
    quality: 0.8,
    caption: 'a photo',
    scene: '',
    ...over,
  };
}

function config(): PublisherConfig {
  return PublisherConfig.create({
    publisherId: 'pub-1',
    frequency: 'weekly',
    photosPerPost: 5,
    requireApproval: true,
  });
}

describe('SuggestPhotosUseCase', () => {
  it('scans the library using the configured lookback window', async () => {
    const library = new FakeMediaLibrary([candidate('a')]);
    const useCase = new SuggestPhotosUseCase(
      library,
      new FakePhotoClassifier(new Map([['a', classification('a')]])),
      new FakeSentPhotoTracker(),
    );

    await useCase.execute(config());

    expect(library.lastLookbackDays).toBe(7);
  });

  it('short-circuits without classifying when the library is empty', async () => {
    const classifier = new FakePhotoClassifier();
    const useCase = new SuggestPhotosUseCase(new FakeMediaLibrary([]), classifier, new FakeSentPhotoTracker());

    const { batch } = await useCase.execute(config());

    expect(batch).toEqual([]);
    expect(classifier.receivedCandidateIds).toEqual([]);
  });

  it('classifies the scanned candidates and returns the selected batch', async () => {
    const library = new FakeMediaLibrary([candidate('a'), candidate('b')]);
    const classifier = new FakePhotoClassifier(
      new Map([
        ['a', classification('a', { quality: 0.9 })],
        ['b', classification('b', { quality: 0.5 })],
      ]),
    );
    const useCase = new SuggestPhotosUseCase(library, classifier, new FakeSentPhotoTracker());

    const { batch } = await useCase.execute(config());

    expect(classifier.receivedCandidateIds).toEqual(['a', 'b']);
    expect(batch.map(c => c.candidate.id)).toEqual(['a', 'b']); // ranked by quality
  });

  it('excludes already-sent photos reported by the tracker', async () => {
    const library = new FakeMediaLibrary([candidate('a'), candidate('b')]);
    const classifier = new FakePhotoClassifier(
      new Map([
        ['a', classification('a')],
        ['b', classification('b')],
      ]),
    );
    const useCase = new SuggestPhotosUseCase(
      library,
      classifier,
      new FakeSentPhotoTracker(new Set(['a'])),
    );

    const { batch } = await useCase.execute(config());

    expect(batch.map(c => c.candidate.id)).toEqual(['b']);
  });
});

describe('SuggestPhotosUseCase — the publisher can always reach their own photos', () => {
  /**
   * The classifier is flaky in the field: rate limits, iCloud originals that
   * never arrive, plain API failures. When it returns almost nothing the pool
   * used to be empty, so a publisher looking at a week with fifty photos in it
   * could not change a single one. The AI picks the opening batch; it must not
   * be what decides whether a person may choose their own photo.
   */
  it('offers the unclassified photos when the classifier returns almost none', async () => {
    const candidates = Array.from({ length: 12 }, (_, i) => candidate(`p${i}`));
    // Only one photo comes back classified; the other eleven fail.
    const classifier = new FakePhotoClassifier(
      new Map([['p0', classification('p0')]]),
    );
    const useCase = new SuggestPhotosUseCase(
      new FakeMediaLibrary(candidates), classifier, new FakeSentPhotoTracker(),
    );

    const { batch, pool, unclassifiedCount } = await useCase.execute(config());

    expect(batch).toHaveLength(1);
    expect(pool).toHaveLength(11); // every other photo in the window
    expect(unclassifiedCount).toBe(11);
  });

  it('puts AI-ranked photos ahead of the ones it never judged', async () => {
    const candidates = Array.from({ length: 8 }, (_, i) => candidate(`p${i}`));
    const classifier = new FakePhotoClassifier(
      new Map([
        ['p0', classification('p0', { quality: 0.9 })],
        ['p1', classification('p1', { quality: 0.8 })],
      ]),
    );
    const useCase = new SuggestPhotosUseCase(
      new FakeMediaLibrary(candidates), classifier, new FakeSentPhotoTracker(),
    );

    const { batch, pool } = await useCase.execute(
      PublisherConfig.create({
        publisherId: 'pub-1', frequency: 'weekly', photosPerPost: 5, requireApproval: true,
      }),
    );

    // Both classified photos are good enough for the batch, so the pool is all
    // unrated — and anything rated would have come first.
    expect(batch.map(c => c.candidate.id).sort()).toEqual(['p0', 'p1']);
    expect(pool.every(c => c.quality === 0)).toBe(true);
  });

  it('never offers a photo that has already been published', async () => {
    const candidates = Array.from({ length: 6 }, (_, i) => candidate(`p${i}`));
    const useCase = new SuggestPhotosUseCase(
      new FakeMediaLibrary(candidates),
      new FakePhotoClassifier(new Map([['p0', classification('p0')]])),
      new FakeSentPhotoTracker(new Set(['p1', 'p2'])),
    );

    const { pool } = await useCase.execute(config());

    expect(pool.map(c => c.candidate.id)).not.toContain('p1');
    expect(pool.map(c => c.candidate.id)).not.toContain('p2');
  });

  it('reports nothing unclassified when every photo was judged', async () => {
    const candidates = [candidate('a'), candidate('b')];
    const useCase = new SuggestPhotosUseCase(
      new FakeMediaLibrary(candidates),
      new FakePhotoClassifier(new Map([
        ['a', classification('a')], ['b', classification('b')],
      ])),
      new FakeSentPhotoTracker(),
    );

    expect((await useCase.execute(config())).unclassifiedCount).toBe(0);
  });
});
