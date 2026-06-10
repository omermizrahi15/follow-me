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

const input = { mediaId: 'media-1', ownerId: 'user-1', localUri: 'file:///local/photo.jpg', filename: 'photo.jpg' };

describe('ShareMediaUseCase', () => {
  it('saves the media and returns a dto', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    const dto = await useCase.share(input);
    expect(dto.id).toBe('media-1');
    expect(dto.url).toBe('https://mock-cdn.test/photo.jpg');
    expect(mediaRepo.all()).toHaveLength(1);
  });

  it('notifies all active subscribers', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-1', 'user-1'));
    await subscriberRepo.save(makeSubscriber('sub-2', 'user-1'));
    await useCase.share(input);
    expect(notifier.wasNotified('sub-1')).toBe(true);
    expect(notifier.wasNotified('sub-2')).toBe(true);
  });

  it('does not notify revoked subscribers', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier } = makeSut();
    const revoked = Subscriber.create({ id: 'sub-revoked', publisherId: 'user-1', contactHandle: '+972509999999', status: 'revoked' });
    await subscriberRepo.save(revoked);
    await useCase.share(input);
    expect(notifier.sent).toHaveLength(0);
  });

  it("does not notify other publishers' subscribers", async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-other', 'user-2'));
    await useCase.share(input);
    expect(notifier.sent).toHaveLength(0);
  });
});
