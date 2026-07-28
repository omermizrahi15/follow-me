import { BackfillHistoryUseCase } from './BackfillHistoryUseCase';
import type { BackfillDraft } from './BackfillHistoryUseCase';
import { SuggestPhotosUseCase } from './SuggestPhotosUseCase';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import {
  FakeMediaLibrary,
  FakePhotoClassifier,
  FakeSentPhotoTracker,
} from '../../test-support/fakes';

const START = new Date('2026-06-01T00:00:00Z');
const END = new Date('2026-06-22T00:00:00Z'); // 3 weekly windows

function candidate(id: string, createdAt: string): PhotoCandidate {
  return { id, uri: `https://cdn.test/${id}.jpg`, createdAt: new Date(createdAt) };
}

function classification(c: PhotoCandidate): PhotoClassification {
  return { candidate: c, category: 'nature', confidence: 0.9, quality: 0.8, caption: 'a photo', scene: '' };
}

function config(): PublisherConfig {
  return PublisherConfig.create({
    publisherId: 'pub-1',
    frequency: 'weekly',
    photosPerPost: 5,
    requireApproval: true,
  });
}

/** One photo per week, so each of the three windows has exactly one. */
const weeklyPhotos = [
  candidate('week3', '2026-06-18T12:00:00Z'),
  candidate('week2', '2026-06-11T12:00:00Z'),
  candidate('week1', '2026-06-04T12:00:00Z'),
];

function makeSut(photos: PhotoCandidate[] = weeklyPhotos): {
  useCase: BackfillHistoryUseCase;
  library: FakeMediaLibrary;
  classifier: FakePhotoClassifier;
} {
  const library = new FakeMediaLibrary(photos);
  const classifier = new FakePhotoClassifier(new Map(photos.map(p => [p.id, classification(p)])));
  const suggest = new SuggestPhotosUseCase(library, classifier, new FakeSentPhotoTracker());
  return { useCase: new BackfillHistoryUseCase(suggest, classifier), library, classifier };
}

const input = { config: config(), startDate: START, endDate: END, intervalDays: 7 };

const draftIds = (drafts: BackfillDraft[]): string[][] =>
  drafts.map(d => d.batch.map(c => c.candidate.id));

describe('BackfillHistoryUseCase — planning', () => {
  it('reports the window count without scanning anything', () => {
    const { useCase, library } = makeSut();

    const plan = useCase.plan(input);

    expect(plan.total).toBe(3);
    expect(library.requestedWindows).toEqual([]);
  });

  it('applies a caller-supplied window cap', () => {
    const { useCase } = makeSut();
    const plan = useCase.plan({ ...input, maxWindows: 2 });
    expect(plan.windows).toHaveLength(2);
    expect(plan.truncated).toBe(true);
  });
});

describe('BackfillHistoryUseCase — scanning', () => {
  it('scans one window per interval, newest first', async () => {
    const { useCase, library } = makeSut();

    await useCase.execute(input);

    expect(library.requestedWindows.map(w => w.start.toISOString())).toEqual([
      '2026-06-15T00:00:00.000Z',
      '2026-06-08T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
    ]);
  });

  it('produces one draft per window, each holding only that window’s photos', async () => {
    const { useCase } = makeSut();

    const { drafts } = await useCase.execute(input);

    expect(draftIds(drafts)).toEqual([['week3'], ['week2'], ['week1']]);
  });

  it('carries each window’s dates on its draft, for back-dating the posting', async () => {
    const { useCase } = makeSut();

    const { drafts } = await useCase.execute(input);

    expect(drafts[0]?.window.start).toEqual(new Date('2026-06-15T00:00:00Z'));
    expect(drafts[0]?.window.end).toEqual(END);
  });

  it('drops windows with no photos — weeks at home are not postings', async () => {
    // Nothing in the middle week.
    const { useCase } = makeSut([weeklyPhotos[0] as PhotoCandidate, weeklyPhotos[2] as PhotoCandidate]);

    const { drafts, scannedWindows } = await useCase.execute(input);

    expect(draftIds(drafts)).toEqual([['week3'], ['week1']]);
    expect(scannedWindows).toBe(3); // all three were still scanned
  });

  it('returns no drafts when the library is empty', async () => {
    const { useCase } = makeSut([]);

    const { drafts, quotaExhausted } = await useCase.execute(input);

    expect(drafts).toEqual([]);
    expect(quotaExhausted).toBe(false);
  });

  it('defaults the end of the range to now', async () => {
    const { useCase, library } = makeSut([]);
    const before = Date.now();

    await useCase.execute({ config: config(), startDate: START, intervalDays: 7, maxWindows: 1 });

    const end = library.requestedWindows[0]?.end.getTime() ?? 0;
    expect(end).toBeGreaterThanOrEqual(before);
    expect(end).toBeLessThanOrEqual(Date.now());
  });
});

describe('BackfillHistoryUseCase — progress', () => {
  it('reports the plan before scanning starts', async () => {
    const { useCase } = makeSut();
    const seen: number[] = [];

    await useCase.execute(input, {
      onPlanned: plan => seen.push(plan.total),
      onWindowStart: () => seen.push(-1),
    });

    expect(seen[0]).toBe(3); // planned first, then windows
  });

  it('reports each window start and finish with 1-based indices', async () => {
    const { useCase } = makeSut();
    const events: string[] = [];

    await useCase.execute(input, {
      onWindowStart: (i, total) => events.push(`start ${i}/${total}`),
      onWindowDone: (i, total) => events.push(`done ${i}/${total}`),
    });

    expect(events).toEqual([
      'start 1/3', 'done 1/3',
      'start 2/3', 'done 2/3',
      'start 3/3', 'done 3/3',
    ]);
  });

  it('reports a null draft for an empty window', async () => {
    const { useCase } = makeSut([weeklyPhotos[0] as PhotoCandidate]);
    const drafts: (BackfillDraft | null)[] = [];

    await useCase.execute(input, { onWindowDone: (_i, _t, d) => drafts.push(d) });

    expect(drafts.map(d => d == null)).toEqual([false, true, true]);
  });
});

describe('BackfillHistoryUseCase — classification quota', () => {
  it('stops scanning once the daily budget is spent', async () => {
    const { useCase, classifier, library } = makeSut();
    classifier.exhaustQuotaFromCall = 2; // first window succeeds, then the budget dies

    const { quotaExhausted, scannedWindows } = await useCase.execute(input);

    expect(quotaExhausted).toBe(true);
    expect(scannedWindows).toBe(2);
    expect(library.requestedWindows).toHaveLength(2); // the third never ran
  });

  it('keeps every window reconstructed before the budget ran out', async () => {
    const { useCase, classifier } = makeSut();
    classifier.exhaustQuotaFromCall = 2;

    const { drafts } = await useCase.execute(input);

    // The completed work survives — the publisher reviews it now and resumes
    // the rest tomorrow, rather than losing the whole run.
    expect(draftIds(drafts)).toEqual([['week3']]);
  });

  it('reports the full plan even when it stopped early, so the UI can say what is left', async () => {
    const { useCase, classifier } = makeSut();
    classifier.exhaustQuotaFromCall = 1;

    const { plan, scannedWindows } = await useCase.execute(input);

    expect(plan.windows).toHaveLength(3);
    expect(scannedWindows).toBe(1);
  });

  it('does not flag exhaustion when the classifier never reports it', async () => {
    const { useCase } = makeSut();
    const { quotaExhausted, scannedWindows } = await useCase.execute(input);
    expect(quotaExhausted).toBe(false);
    expect(scannedWindows).toBe(3);
  });
});
