import { ShareMediaUseCase } from './ShareMediaUseCase';
import { Subscriber } from '../../domain/entities/Subscriber';
import {
  FakeGeocoder,
  InMemoryMediaRepository,
  InMemorySubscriberRepository,
  InMemoryNotifier,
  InMemoryNotificationLogger,
  InMemoryStorageService,
} from '../../test-support/fakes';

function makeSubscriber(id: string, publisherId: string): Subscriber {
  return Subscriber.create({ id, publisherId, contactHandle: '+972501234567', status: 'active' });
}

function makeSut(): {
  useCase: ShareMediaUseCase;
  mediaRepo: InMemoryMediaRepository;
  subscriberRepo: InMemorySubscriberRepository;
  notifier: InMemoryNotifier;
  geocoder: FakeGeocoder;
  deliveryLog: InMemoryNotificationLogger;
} {
  const mediaRepo = new InMemoryMediaRepository();
  const subscriberRepo = new InMemorySubscriberRepository();
  const notifier = new InMemoryNotifier();
  const storage = new InMemoryStorageService();
  const geocoder = new FakeGeocoder();
  const deliveryLog = new InMemoryNotificationLogger();
  const useCase = new ShareMediaUseCase(mediaRepo, subscriberRepo, notifier, storage, geocoder, deliveryLog);
  return { useCase, mediaRepo, subscriberRepo, notifier, geocoder, deliveryLog };
}

const singleItem = [{ mediaId: 'media-1', localUri: 'file:///local/photo.jpg', filename: 'photo.jpg' }];
const multipleItems = [
  { mediaId: 'media-1', localUri: 'file:///local/a.jpg', filename: 'a.jpg' },
  { mediaId: 'media-2', localUri: 'file:///local/b.jpg', filename: 'b.jpg' },
  { mediaId: 'media-3', localUri: 'file:///local/c.jpg', filename: 'c.jpg' },
];

describe('ShareMediaUseCase — single item', () => {
  it('saves the media and returns a dto', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    const dtos = await useCase.share({ ownerId: 'user-1', items: singleItem });
    expect(dtos).toHaveLength(1);
    expect(dtos[0]?.id).toBe('media-1');
    expect(dtos[0]?.url).toBe('https://mock-cdn.test/photo.jpg');
    expect(mediaRepo.all()).toHaveLength(1);
  });
});

describe('ShareMediaUseCase — multiple items', () => {
  it('saves all media to the repository', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await useCase.share({ ownerId: 'user-1', items: multipleItems });
    expect(mediaRepo.all()).toHaveLength(3);
  });

  it('returns a dto for every uploaded item', async (): Promise<void> => {
    const { useCase } = makeSut();
    const dtos = await useCase.share({ ownerId: 'user-1', items: multipleItems });
    expect(dtos).toHaveLength(3);
    expect(dtos.map(d => d.id)).toEqual(['media-1', 'media-2', 'media-3']);
  });

  it('sends ONE notification per subscriber containing all media', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-1', 'user-1'));
    await subscriberRepo.save(makeSubscriber('sub-2', 'user-1'));
    await useCase.share({ ownerId: 'user-1', items: multipleItems });
    expect(notifier.sent).toHaveLength(2);
    expect(notifier.sent[0]?.media).toHaveLength(3);
    expect(notifier.sent[1]?.media).toHaveLength(3);
  });

  it('does not send separate notifications for each media item', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-1', 'user-1'));
    await useCase.share({ ownerId: 'user-1', items: multipleItems });
    expect(notifier.sent).toHaveLength(1);
  });
});

describe('ShareMediaUseCase — posting grouping', () => {
  it('stamps every item of one share with the same postingId', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await useCase.share({ ownerId: 'user-1', items: multipleItems });
    const postingIds = mediaRepo.all().map(m => m.postingId);
    expect(postingIds[0]).toBeDefined();
    expect(new Set(postingIds).size).toBe(1);
  });

  it('uses a different postingId for each share call', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await useCase.share({ ownerId: 'user-1', items: singleItem });
    await useCase.share({
      ownerId: 'user-1',
      items: [{ mediaId: 'media-2', localUri: 'file:///local/d.jpg', filename: 'd.jpg' }],
    });
    const postingIds = mediaRepo.all().map(m => m.postingId);
    expect(new Set(postingIds).size).toBe(2);
  });

});

describe('ShareMediaUseCase — posting location', () => {
  const lisbonItems = [
    { mediaId: 'media-1', localUri: 'file:///local/a.jpg', filename: 'a.jpg', coordinate: { latitude: 38.71, longitude: -9.13 } },
    { mediaId: 'media-2', localUri: 'file:///local/b.jpg', filename: 'b.jpg', coordinate: { latitude: 38.73, longitude: -9.15 } },
    { mediaId: 'media-3', localUri: 'file:///local/c.jpg', filename: 'c.jpg' }, // no GPS
  ];

  // The label alone can't be plotted — the Me-page globe needs the raw fix, so
  // each item keeps its own coordinate rather than only the batch's place name.
  it('persists each item’s own coordinate, not just the place label', async (): Promise<void> => {
    const { useCase, mediaRepo, geocoder } = makeSut();
    geocoder.returns('Lisbon, Portugal');
    await useCase.share({ ownerId: 'user-1', items: lisbonItems });
    expect(mediaRepo.all().map(m => m.coordinate)).toEqual([
      { latitude: 38.71, longitude: -9.13 },
      { latitude: 38.73, longitude: -9.15 },
      undefined, // the item with no GPS stays unplotted
    ]);
  });

  it('stamps the geocoded place on every item of the posting', async (): Promise<void> => {
    const { useCase, mediaRepo, geocoder } = makeSut();
    geocoder.returns('Lisbon, Portugal');
    await useCase.share({ ownerId: 'user-1', items: lisbonItems });
    expect(mediaRepo.all().map(m => m.location)).toEqual([
      'Lisbon, Portugal', 'Lisbon, Portugal', 'Lisbon, Portugal',
    ]);
  });

  it('geocodes once per share, at the batch median coordinate', async (): Promise<void> => {
    const { useCase, geocoder } = makeSut();
    await useCase.share({ ownerId: 'user-1', items: lisbonItems });
    expect(geocoder.calls).toEqual([{ latitude: 38.72, longitude: -9.14 }]);
  });

  it('names both places when the batch spans two cities, largest group first', async (): Promise<void> => {
    const { useCase, mediaRepo, geocoder } = makeSut();
    geocoder.returnsInOrder('Lisbon, Portugal', 'Porto, Portugal');
    await useCase.share({
      ownerId: 'user-1',
      items: [
        { mediaId: 'm1', localUri: 'file:///a.jpg', filename: 'a.jpg', coordinate: { latitude: 38.71, longitude: -9.13 } },
        { mediaId: 'm2', localUri: 'file:///b.jpg', filename: 'b.jpg', coordinate: { latitude: 38.73, longitude: -9.15 } },
        { mediaId: 'm3', localUri: 'file:///c.jpg', filename: 'c.jpg', coordinate: { latitude: 41.15, longitude: -8.61 } },
      ],
    });
    expect(mediaRepo.all().every(m => m.location === 'Lisbon, Portugal & Porto, Portugal')).toBe(true);
  });

  it('names up to three places for a multi-city batch', async (): Promise<void> => {
    const { useCase, mediaRepo, geocoder } = makeSut();
    geocoder.returnsInOrder('Lisbon, Portugal', 'Madrid, Spain', 'Rome, Italy');
    await useCase.share({
      ownerId: 'user-1',
      items: [
        { mediaId: 'm1', localUri: 'file:///a.jpg', filename: 'a.jpg', coordinate: { latitude: 38.72, longitude: -9.14 } },
        { mediaId: 'm2', localUri: 'file:///b.jpg', filename: 'b.jpg', coordinate: { latitude: 40.42, longitude: -3.70 } },
        { mediaId: 'm3', localUri: 'file:///c.jpg', filename: 'c.jpg', coordinate: { latitude: 41.90, longitude: 12.50 } },
      ],
    });
    expect(mediaRepo.all().every(m => m.location === 'Lisbon, Portugal, Madrid, Spain & Rome, Italy')).toBe(true);
  });

  it('uses the publisher-edited place verbatim and skips geocoding', async (): Promise<void> => {
    const { useCase, mediaRepo, geocoder } = makeSut();
    await useCase.share({ ownerId: 'user-1', items: lisbonItems, location: 'Secret beach 🏖️' });
    expect(geocoder.calls).toHaveLength(0);
    expect(mediaRepo.all().every(m => m.location === 'Secret beach 🏖️')).toBe(true);
  });

  it('treats an explicitly cleared place (empty string) as no place', async (): Promise<void> => {
    const { useCase, mediaRepo, geocoder } = makeSut();
    await useCase.share({ ownerId: 'user-1', items: lisbonItems, location: '' });
    expect(geocoder.calls).toHaveLength(0);
    expect(mediaRepo.all().every(m => m.location == null)).toBe(true);
  });

  it('dedupes clusters that resolve to the same place name', async (): Promise<void> => {
    const { useCase, mediaRepo, geocoder } = makeSut();
    geocoder.returns('Lisbon, Portugal'); // both clusters resolve identically
    await useCase.share({
      ownerId: 'user-1',
      items: [
        { mediaId: 'm1', localUri: 'file:///a.jpg', filename: 'a.jpg', coordinate: { latitude: 38.72, longitude: -9.14 } },
        { mediaId: 'm2', localUri: 'file:///b.jpg', filename: 'b.jpg', coordinate: { latitude: 39.40, longitude: -9.14 } },
      ],
    });
    expect(mediaRepo.all().every(m => m.location === 'Lisbon, Portugal')).toBe(true);
  });

  it('does not geocode when no item carries GPS', async (): Promise<void> => {
    const { useCase, mediaRepo, geocoder } = makeSut();
    await useCase.share({ ownerId: 'user-1', items: multipleItems });
    expect(geocoder.calls).toHaveLength(0);
    expect(mediaRepo.all().every(m => m.location == null)).toBe(true);
  });

  it('still shares when the geocoder fails', async (): Promise<void> => {
    const { useCase, mediaRepo, geocoder } = makeSut();
    geocoder.failOnNextCall();
    const dtos = await useCase.share({ ownerId: 'user-1', items: lisbonItems });
    expect(dtos).toHaveLength(3);
    expect(mediaRepo.all().every(m => m.location == null)).toBe(true);
  });

  it('leaves location empty when the geocoder cannot resolve the place', async (): Promise<void> => {
    const { useCase, mediaRepo, geocoder } = makeSut();
    geocoder.returns(null);
    await useCase.share({ ownerId: 'user-1', items: lisbonItems });
    expect(mediaRepo.all().every(m => m.location == null)).toBe(true);
  });

  it('works without a geocoder wired at all', async (): Promise<void> => {
    const mediaRepo = new InMemoryMediaRepository();
    const useCase = new ShareMediaUseCase(
      mediaRepo, new InMemorySubscriberRepository(), new InMemoryNotifier(), new InMemoryStorageService(),
    );
    const dtos = await useCase.share({ ownerId: 'user-1', items: lisbonItems });
    expect(dtos).toHaveLength(3);
    expect(mediaRepo.all().every(m => m.location == null)).toBe(true);
  });
});

describe('ShareMediaUseCase — subscriber filtering', () => {
  it('notifies all active subscribers', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-1', 'user-1'));
    await subscriberRepo.save(makeSubscriber('sub-2', 'user-1'));
    await useCase.share({ ownerId: 'user-1', items: singleItem });
    expect(notifier.wasNotified('sub-1')).toBe(true);
    expect(notifier.wasNotified('sub-2')).toBe(true);
  });

  it('does not notify revoked subscribers', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier } = makeSut();
    const revoked = Subscriber.create({ id: 'sub-revoked', publisherId: 'user-1', contactHandle: '+972509999999', status: 'revoked' });
    await subscriberRepo.save(revoked);
    await useCase.share({ ownerId: 'user-1', items: singleItem });
    expect(notifier.sent).toHaveLength(0);
  });

  it('does not notify subscribers of other publishers', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-other', 'user-2'));
    await useCase.share({ ownerId: 'user-1', items: singleItem });
    expect(notifier.sent).toHaveLength(0);
  });
});

describe('ShareMediaUseCase — delivery logging', () => {
  it('marks every (photo, subscriber) pair sent on success', async (): Promise<void> => {
    const { useCase, subscriberRepo, deliveryLog } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-1', 'user-1'));
    await subscriberRepo.save(makeSubscriber('sub-2', 'user-1'));
    await useCase.share({ ownerId: 'user-1', items: multipleItems });
    expect(deliveryLog.all()).toHaveLength(6); // 3 photos × 2 subscribers
    expect(deliveryLog.all().every(d => d.status === 'sent')).toBe(true);
    expect(deliveryLog.statusOf('media-1', 'sub-1')).toBe('sent');
  });

  it('stamps the publisher on every delivery entry', async (): Promise<void> => {
    const { useCase, subscriberRepo, deliveryLog } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-1', 'user-1'));
    await useCase.share({ ownerId: 'user-1', items: singleItem });
    expect(deliveryLog.all().every(d => d.publisherId === 'user-1')).toBe(true);
  });

  it('marks deliveries failed when the notifier gives up, without failing the share', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier, deliveryLog } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-ok', 'user-1'));
    await subscriberRepo.save(makeSubscriber('sub-bad', 'user-1'));
    notifier.failFor('sub-bad');

    const dtos = await useCase.share({ ownerId: 'user-1', items: singleItem });

    expect(dtos).toHaveLength(1); // the share itself succeeds
    expect(deliveryLog.statusOf('media-1', 'sub-ok')).toBe('sent');
    expect(deliveryLog.statusOf('media-1', 'sub-bad')).toBe('failed');
  });

  it('still notifies the other subscribers when one delivery fails', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-bad', 'user-1'));
    await subscriberRepo.save(makeSubscriber('sub-ok', 'user-1'));
    notifier.failFor('sub-bad');
    await useCase.share({ ownerId: 'user-1', items: singleItem });
    expect(notifier.wasNotified('sub-ok')).toBe(true);
  });

  it('logs nothing when there are no subscribers', async (): Promise<void> => {
    const { useCase, deliveryLog } = makeSut();
    await useCase.share({ ownerId: 'user-1', items: multipleItems });
    expect(deliveryLog.all()).toHaveLength(0);
  });

  it('still shares and notifies when the delivery log is down', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier, deliveryLog } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-1', 'user-1'));
    deliveryLog.failing = true;
    const dtos = await useCase.share({ ownerId: 'user-1', items: singleItem });
    expect(dtos).toHaveLength(1);
    expect(notifier.wasNotified('sub-1')).toBe(true);
  });

  it('works without a delivery log wired at all', async (): Promise<void> => {
    const notifier = new InMemoryNotifier();
    const subscriberRepo = new InMemorySubscriberRepository();
    await subscriberRepo.save(makeSubscriber('sub-1', 'user-1'));
    const useCase = new ShareMediaUseCase(
      new InMemoryMediaRepository(), subscriberRepo, notifier, new InMemoryStorageService(),
    );
    await useCase.share({ ownerId: 'user-1', items: singleItem });
    expect(notifier.wasNotified('sub-1')).toBe(true);
  });
});

describe('ShareMediaUseCase — history backfill (issue #81)', () => {
  it('back-dates the posting to the supplied date', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    const when = new Date('2026-03-14T10:00:00Z');
    await useCase.share({ ownerId: 'user-1', items: multipleItems, createdAt: when });
    expect(mediaRepo.all().map(m => m.createdAt)).toEqual([when, when, when]);
  });

  it('defaults to now when no date is supplied', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    const before = Date.now();
    await useCase.share({ ownerId: 'user-1', items: singleItem });
    const createdAt = mediaRepo.all()[0]?.createdAt.getTime() ?? 0;
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(Date.now());
  });

  it('sends no notifications at all when notify is false', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-1', 'user-1'));
    await subscriberRepo.save(makeSubscriber('sub-2', 'user-1'));

    await useCase.share({ ownerId: 'user-1', items: multipleItems, notify: false });

    expect(notifier.sent).toEqual([]);
  });

  it('writes no delivery rows when notify is false', async (): Promise<void> => {
    const { useCase, subscriberRepo, deliveryLog } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-1', 'user-1'));

    await useCase.share({ ownerId: 'user-1', items: singleItem, notify: false });

    // A suppressed send must leave no trace — a 'pending' row with no attempt
    // would read as a delivery that silently failed.
    expect(await deliveryLog.findByPhoto('media-1')).toEqual([]);
  });

  it('still saves the media and returns dtos when notify is false', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    const dtos = await useCase.share({ ownerId: 'user-1', items: multipleItems, notify: false });
    expect(dtos).toHaveLength(3);
    expect(mediaRepo.all()).toHaveLength(3);
  });

  it('notifies as usual when notify is omitted or true', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-1', 'user-1'));

    await useCase.share({ ownerId: 'user-1', items: singleItem });
    await useCase.share({ ownerId: 'user-1', items: singleItem, notify: true });

    expect(notifier.sent).toHaveLength(2);
  });

  it('flags backfilled items so the feed can tell them from live sends', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await useCase.share({ ownerId: 'user-1', items: singleItem, notify: false, backfilled: true });
    expect(mediaRepo.all()[0]?.backfilled).toBe(true);
  });

  it('leaves live postings unflagged', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await useCase.share({ ownerId: 'user-1', items: singleItem });
    expect(mediaRepo.all()[0]?.backfilled).toBe(false);
  });
});

describe('ShareMediaUseCase — input validation', () => {
  it('throws before uploading when ownerId is empty', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await expect(
      useCase.share({ ownerId: '', items: singleItem }),
    ).rejects.toThrow('ownerId is required');
    expect(mediaRepo.all()).toHaveLength(0);
  });
});
