import { SharePhotoUseCase } from './SharePhotoUseCase';
import { Subscriber } from '../../domain/entities/Subscriber';
import {
  InMemoryPhotoRepository,
  InMemorySubscriberRepository,
  InMemoryNotifier,
  InMemoryStorageService,
} from '../../infrastructure/InMemoryDoubles';

function makeSubscriber(id: string, publisherId: string): Subscriber {
  return Subscriber.create({ id, publisherId, contactHandle: '+972501234567', status: 'active' });
}

function makeSut(): {
  useCase: SharePhotoUseCase;
  photoRepo: InMemoryPhotoRepository;
  subscriberRepo: InMemorySubscriberRepository;
  notifier: InMemoryNotifier;
} {
  const photoRepo = new InMemoryPhotoRepository();
  const subscriberRepo = new InMemorySubscriberRepository();
  const notifier = new InMemoryNotifier();
  const storage = new InMemoryStorageService();
  const useCase = new SharePhotoUseCase(photoRepo, subscriberRepo, notifier, storage);
  return { useCase, photoRepo, subscriberRepo, notifier };
}

const baseInput = { photoId: 'photo-1', ownerId: 'user-1', localUri: 'file:///local/photo.jpg', filename: 'photo.jpg' };

describe('SharePhotoUseCase', () => {
  it('saves the photo and returns a dto', async (): Promise<void> => {
    const { useCase, photoRepo } = makeSut();
    const dto = await useCase.execute(baseInput);
    expect(dto.id).toBe('photo-1');
    expect(dto.url).toBe('https://mock-cdn.test/photo.jpg');
    expect(photoRepo.all()).toHaveLength(1);
  });

  it('notifies all active subscribers', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-1', 'user-1'));
    await subscriberRepo.save(makeSubscriber('sub-2', 'user-1'));
    await useCase.execute(baseInput);
    expect(notifier.sent).toHaveLength(2);
    expect(notifier.wasNotified('sub-1')).toBe(true);
    expect(notifier.wasNotified('sub-2')).toBe(true);
  });

  it('does not notify revoked subscribers', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier } = makeSut();
    const revoked = Subscriber.create({ id: 'sub-revoked', publisherId: 'user-1', contactHandle: '+972509999999', status: 'revoked' });
    await subscriberRepo.save(revoked);
    await useCase.execute(baseInput);
    expect(notifier.sent).toHaveLength(0);
  });

  it('does not notify subscribers of other publishers', async (): Promise<void> => {
    const { useCase, subscriberRepo, notifier } = makeSut();
    await subscriberRepo.save(makeSubscriber('sub-other', 'user-2'));
    await useCase.execute(baseInput);
    expect(notifier.sent).toHaveLength(0);
  });
});
