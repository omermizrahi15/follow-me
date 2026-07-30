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

describe('SuggestPhotosUseCase — topping up an open review (the "+" slot)', () => {
  function useCaseWith(
    library: FakeMediaLibrary,
    classifier: FakePhotoClassifier,
    sent: Set<string> = new Set(),
  ): SuggestPhotosUseCase {
    return new SuggestPhotosUseCase(library, classifier, new FakeSentPhotoTracker(sent));
  }

  describe('pendingCandidates', () => {
    it('offers the window photos that are not already on screen', async () => {
      const library = new FakeMediaLibrary([candidate('a'), candidate('b'), candidate('c')]);
      const useCase = useCaseWith(library, new FakePhotoClassifier());

      const pending = await useCase.pendingCandidates(config(), new Set(['a']));

      expect(pending.map(c => c.id)).toEqual(['b', 'c']);
      expect(library.lastLookbackDays).toBe(7);
    });

    it('never re-offers a photo that has already been published', async () => {
      const library = new FakeMediaLibrary([candidate('a'), candidate('b')]);
      const useCase = useCaseWith(library, new FakePhotoClassifier(), new Set(['b']));

      const pending = await useCase.pendingCandidates(config());

      expect(pending.map(c => c.id)).toEqual(['a']);
    });

    it('collapses bursts, so the top-up cannot offer the near-duplicates the scan skipped', async () => {
      const moment = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
      const library = new FakeMediaLibrary([
        { id: 'a', uri: 'https://cdn.test/a.jpg', createdAt: moment },
        { id: 'a-burst', uri: 'https://cdn.test/a-burst.jpg', createdAt: new Date(moment.getTime() + 1_000) },
      ]);
      const useCase = useCaseWith(library, new FakePhotoClassifier());

      const pending = await useCase.pendingCandidates(config());

      expect(pending.map(c => c.id)).toEqual(['a']);
    });
  });

  describe('classifyMore', () => {
    /** `count` candidates, each classified into `category` when the fake sees it. */
    function wave(
      prefix: string,
      count: number,
      category: PhotoClassification['category'] = 'nature',
    ): { candidates: PhotoCandidate[]; byId: Map<string, PhotoClassification> } {
      const candidates = Array.from({ length: count }, (_, i) => candidate(`${prefix}${i}`));
      const byId = new Map(
        candidates.map(c => [c.id, { ...classification(c.id, { category }), candidate: c }]),
      );
      return { candidates, byId };
    }

    it('stops at the first wave once it has a photo worth suggesting', async () => {
      const { candidates, byId } = wave('p', 12);
      const classifier = new FakePhotoClassifier(byId);
      const useCase = useCaseWith(new FakeMediaLibrary(), classifier);

      const result = await useCase.classifyMore(candidates, config());

      // One wave of 4 — the other 8 photos cost nothing until asked for.
      expect(result.consumed).toBe(4);
      expect(result.suggestions).toHaveLength(4);
      expect(classifier.callCount).toBe(1);
    });

    it('keeps looking past photos the AI would not suggest', async () => {
      const junk = wave('junk', 4, 'other');
      const good = wave('good', 4, 'nature');
      const classifier = new FakePhotoClassifier(new Map([...junk.byId, ...good.byId]));
      const useCase = useCaseWith(new FakeMediaLibrary(), classifier);

      const result = await useCase.classifyMore([...junk.candidates, ...good.candidates], config());

      expect(result.consumed).toBe(8);
      expect(result.suggestions.map(c => c.candidate.id)).toEqual(good.candidates.map(c => c.id));
      // The rejects still come back — they are what the pool is made of.
      expect(result.classified).toHaveLength(8);
    });

    it('spends candidates the classifier could not read, so they are not retried forever', async () => {
      const unreadable = Array.from({ length: 4 }, (_, i) => candidate(`x${i}`));
      const good = wave('good', 4);
      const useCase = useCaseWith(
        new FakeMediaLibrary(),
        new FakePhotoClassifier(good.byId),
      );

      const result = await useCase.classifyMore([...unreadable, ...good.candidates], config());

      expect(result.consumed).toBe(8);
      expect(result.suggestions).toHaveLength(4);
    });

    it('reports the window as spent when it runs out of candidates', async () => {
      const junk = wave('junk', 3, 'other');
      const useCase = useCaseWith(new FakeMediaLibrary(), new FakePhotoClassifier(junk.byId));

      const result = await useCase.classifyMore(junk.candidates, config());

      expect(result.consumed).toBe(3);
      expect(result.suggestions).toEqual([]);
      expect(result.quotaExhausted).toBe(false);
    });

    it('stops and says so when the day\'s AI budget is gone', async () => {
      const { candidates, byId } = wave('p', 12);
      const classifier = new FakePhotoClassifier(byId);
      classifier.quotaExhaustedFromCallIndex = 1;
      const useCase = useCaseWith(new FakeMediaLibrary(), classifier);

      const result = await useCase.classifyMore(candidates, config());

      expect(result.quotaExhausted).toBe(true);
      expect(result.suggestions).toEqual([]);
      // One wave attempted, then it gives up instead of walking the window.
      expect(classifier.callCount).toBe(1);
    });

    it('honours a larger want by running more waves', async () => {
      const { candidates, byId } = wave('p', 12);
      const useCase = useCaseWith(new FakeMediaLibrary(), new FakePhotoClassifier(byId));

      const result = await useCase.classifyMore(candidates, config(), 5);

      expect(result.consumed).toBe(8);
      expect(result.suggestions).toHaveLength(8);
    });
  });
});
