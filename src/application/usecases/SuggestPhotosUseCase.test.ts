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
    category: 'view_only',
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
