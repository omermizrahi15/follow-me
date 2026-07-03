import { ShareMediaUseCase } from './ShareMediaUseCase';
import { Subscriber } from '../../domain/entities/Subscriber';
import {
  InMemoryMediaRepository,
  InMemorySubscriberRepository,
  InMemoryNotifier,
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
} {
  const mediaRepo = new InMemoryMediaRepository();
  const subscriberRepo = new InMemorySubscriberRepository();
  const notifier = new InMemoryNotifier();
  const storage = new InMemoryStorageService();
  const useCase = new ShareMediaUseCase(mediaRepo, subscriberRepo, notifier, storage);
  return { useCase, mediaRepo, subscriberRepo, notifier };
}

const singleItem = [{ mediaId: 'media-1', localUri: 'file:///local/photo.jpg', filename: 'photo.jpg' }];
const multipleItems = [
  { mediaId: 'media-1', localUri: 'file:///local/a.jpg', filename: 'a.jpg' },
  { mediaId: 'media-2', localUri: 'file:///local/b.jpg', filename: 'b.jpg' },
  { mediaId: 'media-3', localUri: 'file:///local/c.mp4', filename: 'c.mp4' },
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

  it('keeps the item mediaType on the saved media', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await useCase.share({
      ownerId: 'user-1',
      items: [{ mediaId: 'media-1', localUri: 'file:///local/c.mp4', filename: 'c.mp4', mediaType: 'video' }],
    });
    expect(mediaRepo.all()[0]?.mediaType).toBe('video');
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

describe('ShareMediaUseCase — input validation', () => {
  it('throws before uploading when ownerId is empty', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await expect(
      useCase.share({ ownerId: '', items: singleItem }),
    ).rejects.toThrow('ownerId is required');
    expect(mediaRepo.all()).toHaveLength(0);
  });
});
