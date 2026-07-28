import { BackfillHistoryUseCase } from './usecases/BackfillHistoryUseCase';
import { SuggestPhotosUseCase } from './usecases/SuggestPhotosUseCase';
import { ShareMediaUseCase } from './usecases/ShareMediaUseCase';
import { PublisherConfig } from '../domain/entities/PublisherConfig';
import { Subscriber } from '../domain/entities/Subscriber';
import type { PhotoCandidate } from '../domain/entities/PhotoCandidate';
import type { PhotoClassification } from '../domain/entities/PhotoClassification';
import {
  FakeMediaLibrary,
  FakePhotoClassifier,
  FakeSentPhotoTracker,
  InMemoryMediaRepository,
  InMemoryNotificationLogger,
  InMemoryNotifier,
  InMemoryStorageService,
  InMemorySubscriberRepository,
} from '../test-support/fakes';

/**
 * Flow test for the history backfill exactly as the screen runs it
 * (issue #81): plan windows → suggest per window → publish each draft
 * back-dated and silent.
 *
 * THE INVARIANT (regression guard): reconstructing history NEVER messages a
 * subscriber. A publisher rebuilding a year of travel would otherwise blast
 * every follower with dozens of WhatsApp messages — the single worst thing
 * this feature could do. It is asserted here at the composed level, not just
 * on ShareMediaUseCase, because the guarantee lives in the wiring.
 */

const START = new Date('2026-06-01T00:00:00Z');
const END = new Date('2026-06-22T00:00:00Z'); // three weekly windows

function candidate(id: string, createdAt: string): PhotoCandidate {
  return { id, uri: `file:///photos/${id}.jpg`, createdAt: new Date(createdAt) };
}

function classification(c: PhotoCandidate): PhotoClassification {
  return { candidate: c, category: 'nature', confidence: 0.9, quality: 0.8, caption: '', scene: c.id };
}

/** Two photos in each of the three weekly windows. */
const photos = [
  candidate('w3-a', '2026-06-20T09:00:00Z'),
  candidate('w3-b', '2026-06-18T09:00:00Z'),
  candidate('w2-a', '2026-06-13T09:00:00Z'),
  candidate('w2-b', '2026-06-11T09:00:00Z'),
  candidate('w1-a', '2026-06-06T09:00:00Z'),
  candidate('w1-b', '2026-06-04T09:00:00Z'),
];

function makeSut(): {
  backfill: BackfillHistoryUseCase;
  share: ShareMediaUseCase;
  mediaRepo: InMemoryMediaRepository;
  notifier: InMemoryNotifier;
  deliveryLog: InMemoryNotificationLogger;
  subscriberRepo: InMemorySubscriberRepository;
  config: PublisherConfig;
} {
  const library = new FakeMediaLibrary(photos);
  const classifier = new FakePhotoClassifier(new Map(photos.map(p => [p.id, classification(p)])));
  const suggest = new SuggestPhotosUseCase(library, classifier, new FakeSentPhotoTracker());
  const backfill = new BackfillHistoryUseCase(suggest, classifier);

  const mediaRepo = new InMemoryMediaRepository();
  const subscriberRepo = new InMemorySubscriberRepository();
  const notifier = new InMemoryNotifier();
  const deliveryLog = new InMemoryNotificationLogger();
  const share = new ShareMediaUseCase(
    mediaRepo, subscriberRepo, notifier, new InMemoryStorageService(), undefined, deliveryLog,
  );

  const config = PublisherConfig.create({
    publisherId: 'pub-1',
    frequency: 'weekly',
    photosPerPost: 5,
    requireApproval: true,
  });

  return { backfill, share, mediaRepo, notifier, deliveryLog, subscriberRepo, config };
}

/** The screen's publish loop: one silent, back-dated share per kept draft. */
async function runBackfill(sut: ReturnType<typeof makeSut>): Promise<void> {
  const { drafts } = await sut.backfill.execute({
    config: sut.config,
    startDate: START,
    endDate: END,
    intervalDays: 7,
  });

  for (const draft of drafts) {
    const newest = draft.batch.reduce(
      (latest, c) => (c.candidate.createdAt > latest ? c.candidate.createdAt : latest),
      draft.batch[0]?.candidate.createdAt ?? draft.window.end,
    );
    await sut.share.share({
      ownerId: 'pub-1',
      items: draft.batch.map(c => ({
        mediaId: c.candidate.id,
        localUri: c.candidate.uri,
        filename: `${c.candidate.id}.jpg`,
      })),
      createdAt: newest,
      notify: false,
      backfilled: true,
    });
  }
}

describe('history backfill flow', () => {
  it('INVARIANT: never messages a subscriber, however many postings it writes', async () => {
    const sut = makeSut();
    await sut.subscriberRepo.save(
      Subscriber.create({ id: 'sub-1', publisherId: 'pub-1', contactHandle: '+972501234567', status: 'active' }),
    );
    await sut.subscriberRepo.save(
      Subscriber.create({ id: 'sub-2', publisherId: 'pub-1', contactHandle: '+972501234568', status: 'active' }),
    );

    await runBackfill(sut);

    expect(sut.mediaRepo.all().length).toBeGreaterThan(0); // it really did publish
    expect(sut.notifier.sent).toEqual([]);
  });

  it('leaves no delivery rows behind — a suppressed send is not a failed send', async () => {
    const sut = makeSut();
    await sut.subscriberRepo.save(
      Subscriber.create({ id: 'sub-1', publisherId: 'pub-1', contactHandle: '+972501234567', status: 'active' }),
    );

    await runBackfill(sut);

    for (const media of sut.mediaRepo.all()) {
      expect(await sut.deliveryLog.findByPhoto(media.id)).toEqual([]);
    }
  });

  it('writes one posting per window, back-dated to its own photos', async () => {
    const sut = makeSut();

    await runBackfill(sut);

    const postings = new Map<string, Date>();
    for (const m of sut.mediaRepo.all()) {
      postings.set(m.postingId ?? '', m.createdAt);
    }
    expect(postings.size).toBe(3);
    // Each posting carries the real date of its newest photo, so the feed reads
    // chronologically instead of piling every reconstructed trip at the top.
    expect([...postings.values()].map(d => d.toISOString()).sort()).toEqual([
      '2026-06-06T09:00:00.000Z',
      '2026-06-13T09:00:00.000Z',
      '2026-06-20T09:00:00.000Z',
    ]);
  });

  it('flags every reconstructed item as backfilled', async () => {
    const sut = makeSut();
    await runBackfill(sut);
    expect(sut.mediaRepo.all().every(m => m.backfilled)).toBe(true);
  });

  it('groups each window’s photos into a single posting', async () => {
    const sut = makeSut();

    await runBackfill(sut);

    const byPosting = new Map<string, string[]>();
    for (const m of sut.mediaRepo.all()) {
      const key = m.postingId ?? '';
      byPosting.set(key, [...(byPosting.get(key) ?? []), m.id]);
    }
    // Two photos per window, and no window's photo leaks into another posting.
    for (const ids of byPosting.values()) {
      expect(ids).toHaveLength(2);
      expect(new Set(ids.map(id => id.slice(0, 2))).size).toBe(1);
    }
  });

  it('excludes already-published photos from a second run', async () => {
    const sut = makeSut();
    await runBackfill(sut);
    const publishedIds = new Set(sut.mediaRepo.all().map(m => m.id));

    // A re-run sees the first run's photos as already sent, exactly as the real
    // tracker does (it reads the media table).
    const library = new FakeMediaLibrary(photos);
    const classifier = new FakePhotoClassifier(new Map(photos.map(p => [p.id, classification(p)])));
    const second = new BackfillHistoryUseCase(
      new SuggestPhotosUseCase(library, classifier, new FakeSentPhotoTracker(publishedIds)),
      classifier,
    );

    const { drafts } = await second.execute({
      config: sut.config,
      startDate: START,
      endDate: END,
      intervalDays: 7,
    });

    expect(drafts).toEqual([]);
  });
});
