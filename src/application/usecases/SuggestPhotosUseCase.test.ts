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

    // Newest first: a run cut short by the per-scan cap or the daily quota must
    // spend what budget it has on recent photos, not on the oldest in the window.
    expect(classifier.receivedCandidateIds).toEqual(['b', 'a']);
    expect(batch.map(c => c.candidate.id)).toEqual(['a', 'b']); // ranked by quality
  });

  describe('grading the whole window', () => {
    /** `count` candidates the classifier will grade, plus a lookup for the fake. */
    function window(count: number): { candidates: PhotoCandidate[]; byId: Map<string, PhotoClassification> } {
      const candidates = Array.from({ length: count }, (_, i) => candidate(`p${i}`));
      return {
        candidates,
        byId: new Map(candidates.map(c => [c.id, { ...classification(c.id), candidate: c }])),
      };
    }

    /** In-memory IClassificationStore, so a test can see what was remembered. */
    function store(): { load: jest.Mock; save: jest.Mock; held: Map<string, PhotoClassification> } {
      const held = new Map<string, PhotoClassification>();
      return {
        held,
        load: jest.fn((ids: readonly string[]) =>
          Promise.resolve(new Map([...held].filter(([id]) => ids.includes(id)))),
        ),
        save: jest.fn((cs: readonly PhotoClassification[]) => {
          for (const c of cs) held.set(c.candidate.id, c);
          return Promise.resolve();
        }),
      };
    }

    // The old stop-at-2×-quota is what made every swap a live network round:
    // 5 per post meant 10 graded and the rest of the window never looked at.
    it('grades every photo in the window, not just twice the post size', async () => {
      const { candidates, byId } = window(40);
      const classifier = new FakePhotoClassifier(byId);
      const useCase = new SuggestPhotosUseCase(
        new FakeMediaLibrary(candidates),
        classifier,
        new FakeSentPhotoTracker(),
      );

      const { batch, pool } = await useCase.execute(config());

      expect(classifier.receivedCandidateIds).toHaveLength(40);
      expect(batch).toHaveLength(5);
      expect(pool).toHaveLength(35);
    });

    it('stops at the per-scan cap, keeping the newest photos', async () => {
      const { candidates, byId } = window(30);
      const classifier = new FakePhotoClassifier(byId);
      const useCase = new SuggestPhotosUseCase(
        new FakeMediaLibrary(candidates),
        classifier,
        new FakeSentPhotoTracker(),
        undefined,
        undefined,
        10, // maxPerScan
      );

      await useCase.execute(config());

      // p29 is the newest (candidates are one day apart, ascending).
      expect(classifier.receivedCandidateIds).toHaveLength(10);
      expect(classifier.receivedCandidateIds).toContain('p29');
      expect(classifier.receivedCandidateIds).not.toContain('p0');
    });

    it('never pays to grade the same photo twice', async () => {
      const { candidates, byId } = window(12);
      const grades = store();
      const build = (): SuggestPhotosUseCase =>
        new SuggestPhotosUseCase(
          new FakeMediaLibrary(candidates),
          classifier,
          new FakeSentPhotoTracker(),
          undefined,
          grades,
        );
      const classifier = new FakePhotoClassifier(byId);

      await build().execute(config());
      expect(classifier.receivedCandidateIds).toHaveLength(12);

      const second = new FakePhotoClassifier(byId);
      const rescan = new SuggestPhotosUseCase(
        new FakeMediaLibrary(candidates),
        second,
        new FakeSentPhotoTracker(),
        undefined,
        grades,
      );
      const { batch, pool } = await rescan.execute(config());

      expect(second.receivedCandidateIds).toEqual([]); // no AI calls at all
      expect(batch).toHaveLength(5);
      expect(pool).toHaveLength(7);
    });

    // Grading the whole window takes far longer than grading ten photos, and
    // the publisher must not sit through it before seeing a post.
    it('announces a usable batch before the window finishes grading', async () => {
      const { candidates, byId } = window(40);
      const useCase = new SuggestPhotosUseCase(
        new FakeMediaLibrary(candidates),
        new FakePhotoClassifier(byId),
        new FakeSentPhotoTracker(),
      );

      let gradedWhenAnnounced = -1;
      let seen = 0;
      await useCase.execute(config(), {
        onScanning() {},
        onScanned() {},
        onClassifying() { seen++; },
        onBatchReady(batch) {
          gradedWhenAnnounced = seen;
          expect(batch).toHaveLength(5);
        },
      });

      expect(gradedWhenAnnounced).toBe(config().photosPerPost * 2);
    });
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

      // Newest first, matching the scan — whatever the "+" hands over next
      // should come from the recent end of the window.
      expect(pending.map(c => c.id)).toEqual(['c', 'b']);
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

    /**
     * The history backfill tops up ONE reconstructed stretch (issue #81). The
     * scan stops at 2× photos-per-post, so a stretch reporting sixty photos has
     * most of them unlooked-at — and reaching them through the lookback would
     * hand a June post a photo taken last week.
     */
    it('draws from the given stretch, not the lookback, when one is passed', async () => {
      const inWindow = { id: 'june', uri: 'https://cdn.test/june.jpg', createdAt: new Date(Date.UTC(2026, 5, 3)) };
      const outside = { id: 'today', uri: 'https://cdn.test/today.jpg', createdAt: new Date(Date.UTC(2026, 7, 3)) };
      const library = new FakeMediaLibrary([inWindow, outside]);
      const useCase = useCaseWith(library, new FakePhotoClassifier());
      const window = { start: new Date(Date.UTC(2026, 5, 1)), end: new Date(Date.UTC(2026, 5, 8)) };

      const pending = await useCase.pendingCandidates(config(), new Set(), window);

      expect(pending.map(c => c.id)).toEqual(['june']);
      expect(library.requestedWindows).toEqual([window]);
      // Never the lookback: that is a different stretch of the trip entirely.
      expect(library.lastLookbackDays).toBeNull();
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
