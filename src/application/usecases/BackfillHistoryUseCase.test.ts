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
  return {
    candidate: c, category: 'nature', confidence: 0.9, quality: 0.8, caption: 'a photo', scene: '',
    containsPublisher: false, publisherConfidence: 0, reason: '',
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

  it('plans every window — the cap is on posts produced, not windows walked', () => {
    const { useCase } = makeSut();
    // An empty window costs a library query and no AI, so walking it is nearly
    // free; capping the walk would spend the allowance on quiet months and
    // never reach the ones holding photos.
    const plan = useCase.plan({ ...input, maxWindows: 2 });
    expect(plan.windows).toHaveLength(3);
    expect(plan.truncated).toBe(false);
  });

  it('stops once it has reconstructed the requested number of posts', async () => {
    const { useCase, library } = makeSut();

    const { drafts } = await useCase.execute({ ...input, maxWindows: 2 });

    expect(drafts).toHaveLength(2);
    // Stopped after the second post, rather than walking the third window.
    expect(library.requestedWindows).toHaveLength(2);
  });

  it('walks past empty windows without spending the post allowance', async () => {
    // Photos only in the NEWEST week; the two older windows are quiet.
    const { useCase, library } = makeSut([weeklyPhotos[0] as PhotoCandidate]);

    const { drafts } = await useCase.execute({ ...input, maxWindows: 1 });

    // It kept going through the quiet months and still found the post — this is
    // the case that used to report "nothing to rebuild".
    expect(library.requestedWindows).toHaveLength(3);
    expect(draftIds(drafts)).toEqual([['week3']]);
  });
});

describe('BackfillHistoryUseCase — scanning', () => {
  it('scans one window per interval, oldest first', async () => {
    const { useCase, library } = makeSut();

    await useCase.execute(input);

    // A history is rebuilt forwards from where the trip began, so the first
    // stretch scanned is the start of the travels and the last is nearest today.
    expect(library.requestedWindows.map(w => w.start.toISOString())).toEqual([
      '2026-06-01T00:00:00.000Z',
      '2026-06-08T00:00:00.000Z',
      '2026-06-15T00:00:00.000Z',
    ]);
  });

  it('produces one draft per window, each holding only that window’s photos', async () => {
    const { useCase } = makeSut();

    const { drafts } = await useCase.execute(input);

    expect(draftIds(drafts)).toEqual([['week1'], ['week2'], ['week3']]);
  });

  it('carries each window’s dates on its draft, for back-dating the posting', async () => {
    const { useCase } = makeSut();

    const { drafts } = await useCase.execute(input);

    expect(drafts[0]?.window.start).toEqual(START);
    expect(drafts[drafts.length - 1]?.window.end).toEqual(END);
  });

  it('drops windows with no photos — weeks at home are not postings', async () => {
    // Nothing in the middle week.
    const { useCase } = makeSut([weeklyPhotos[0] as PhotoCandidate, weeklyPhotos[2] as PhotoCandidate]);

    const { drafts, scannedWindows } = await useCase.execute(input);

    expect(draftIds(drafts)).toEqual([['week1'], ['week3']]);
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

    await useCase.execute({ config: config(), startDate: START, intervalDays: 7 });

    // The newest window is scanned last, so its end is the one anchored to now.
    const end = library.requestedWindows[library.requestedWindows.length - 1]?.end.getTime() ?? 0;
    expect(end).toBeGreaterThanOrEqual(before);
    expect(end).toBeLessThanOrEqual(Date.now());
  });
});

describe('BackfillHistoryUseCase — explicit gap windows (issue #81)', () => {
  it('scans only the windows it is given, skipping covered stretches', async () => {
    const { useCase, library } = makeSut();
    // Pretend only the middle week is uncovered.
    const gap = { start: new Date('2026-06-08T00:00:00Z'), end: new Date('2026-06-15T00:00:00Z') };

    const { drafts } = await useCase.execute({ ...input, windows: [gap] });

    expect(library.requestedWindows).toHaveLength(1);
    expect(library.requestedWindows[0]?.start).toEqual(gap.start);
    expect(draftIds(drafts)).toEqual([['week2']]);
  });

  it('plans from the given windows without touching the date range', () => {
    const { useCase, library } = makeSut();
    const gaps = [
      { start: new Date('2026-06-15T00:00:00Z'), end: new Date('2026-06-22T00:00:00Z') },
      { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-06-08T00:00:00Z') },
    ];

    const plan = useCase.plan({ ...input, windows: gaps });

    expect(plan.total).toBe(2);
    // Given newest-first, returned oldest-first.
    expect(plan.windows).toEqual([...gaps].reverse());
    expect(library.requestedWindows).toEqual([]);
  });

  it('keeps every supplied gap in the plan, chronologically', () => {
    const { useCase } = makeSut();
    const many = Array.from({ length: 9 }, (_, i) => ({
      start: new Date(2026, 0, i + 1),
      end: new Date(2026, 0, i + 2),
    }));

    const plan = useCase.plan({ ...input, windows: many, maxWindows: 4 });

    expect(plan.windows).toHaveLength(9);
    expect(plan.windows[0]?.start).toEqual(new Date(2026, 0, 1));
  });
});

describe('BackfillHistoryUseCase — pause (issue #81)', () => {
  it('holds at a window boundary until the gate resolves', async () => {
    const { useCase, library } = makeSut();
    let release = (): void => undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;

    // Gate the SECOND window: the first runs, then the scan waits.
    const running = useCase.execute({
      ...input,
      beforeWindow: () => (++calls === 2 ? held : Promise.resolve()),
    });

    // Let the first window finish, then confirm the scan really is parked.
    await new Promise(r => setTimeout(r, 20));
    expect(library.requestedWindows).toHaveLength(1);

    release();
    await running;
    expect(library.requestedWindows).toHaveLength(3);
  });

  it('never pauses mid-window — the gate is only consulted between them', async () => {
    const { useCase } = makeSut();
    const seen: number[] = [];

    await useCase.execute({
      ...input,
      // One call per window, before it starts: the AI calls already in flight
      // are never abandoned, so a pause cannot waste the quota they cost.
      beforeWindow: () => { seen.push(seen.length); return Promise.resolve(); },
    });

    expect(seen).toHaveLength(3);
  });
});

describe('BackfillHistoryUseCase — what the scan found', () => {
  it('carries each stretch’s scan onto its draft', async () => {
    const { useCase } = makeSut();

    const { drafts } = await useCase.execute(input);

    // One photo per week here, none of them near-duplicates.
    expect(drafts[0]?.scanned).toEqual({ found: 1, unique: 1 });
  });

  it('counts the duplicates deduplication removed', async () => {
    // Three shots seconds apart in week 1: a burst, collapsed to one.
    const burst = [
      candidate('burst-a', '2026-06-04T12:00:00Z'),
      candidate('burst-b', '2026-06-04T12:00:05Z'),
      candidate('burst-c', '2026-06-04T12:00:10Z'),
    ];
    const { useCase } = makeSut(burst);

    const { drafts } = await useCase.execute(input);

    const week1 = drafts[0];
    expect(week1?.scanned.found).toBe(3);
    expect(week1?.scanned.unique).toBe(1);
  });

  it('reports the scan per window, not for the run as a whole', async () => {
    const { useCase } = makeSut();
    const seen: { index: number; found: number }[] = [];

    await useCase.execute(input, {
      onWindowScanned: (index, _total, scan) => seen.push({ index, found: scan.found }),
    });

    // Three windows, each reporting only its own photos.
    expect(seen).toHaveLength(3);
    expect(seen.every(s => s.found === 1)).toBe(true);
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

    // Oldest first, and only the newest week has a photo.
    expect(drafts.map(d => d == null)).toEqual([true, true, false]);
  });
});

describe('BackfillHistoryUseCase — classification quota', () => {
  it('stops scanning once the daily budget is spent', async () => {
    const { useCase, classifier, library } = makeSut();
    classifier.quotaExhaustedFromCallIndex = 2; // first window succeeds, then the budget dies

    const { quotaExhausted, scannedWindows } = await useCase.execute(input);

    expect(quotaExhausted).toBe(true);
    expect(scannedWindows).toBe(2);
    expect(library.requestedWindows).toHaveLength(2); // the third never ran
  });

  it('keeps every window reconstructed before the budget ran out', async () => {
    const { useCase, classifier } = makeSut();
    classifier.quotaExhaustedFromCallIndex = 2;

    const { drafts } = await useCase.execute(input);

    // The completed work survives — the publisher reviews it now and resumes
    // the rest tomorrow, rather than losing the whole run. Oldest first, so the
    // earliest stretch is the one that got done.
    expect(draftIds(drafts)).toEqual([['week1']]);
  });

  it('reports the full plan even when it stopped early, so the UI can say what is left', async () => {
    const { useCase, classifier } = makeSut();
    classifier.quotaExhaustedFromCallIndex = 1;

    const { plan, scannedWindows } = await useCase.execute(input);

    expect(plan.windows).toHaveLength(3);
    expect(scannedWindows).toBe(1);
  });

  it('stops when a window ran out of time, and keeps what it reconstructed', async () => {
    // A deadline that passed is the connection, and the next window travels
    // over the same one. Banking the finished stretches beats grinding the rest
    // against a stall that costs a full deadline each (issue #174).
    const { useCase, classifier, library } = makeSut();
    classifier.timedOutFromCallIndex = 2;

    const { drafts, timedOut, quotaExhausted, scannedWindows } = await useCase.execute(input);

    expect(timedOut).toBe(true);
    expect(quotaExhausted).toBe(false);
    expect(scannedWindows).toBe(2);
    expect(library.requestedWindows).toHaveLength(2);
    expect(draftIds(drafts)).toEqual([['week1']]);
  });

  it('does not flag exhaustion when the classifier never reports it', async () => {
    const { useCase } = makeSut();
    const { quotaExhausted, scannedWindows } = await useCase.execute(input);
    expect(quotaExhausted).toBe(false);
    expect(scannedWindows).toBe(3);
  });
});
