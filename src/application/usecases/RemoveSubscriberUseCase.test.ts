import { RemoveSubscriberUseCase } from './RemoveSubscriberUseCase';
import { Subscriber } from '../../domain/entities/Subscriber';
import { InMemorySubscriberRepository } from '../../test-support/fakes';

function makeSut(): { useCase: RemoveSubscriberUseCase; repo: InMemorySubscriberRepository } {
  const repo = new InMemorySubscriberRepository();
  const useCase = new RemoveSubscriberUseCase(repo);
  return { useCase, repo };
}

describe('RemoveSubscriberUseCase', () => {
  it('revokes an active subscriber', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    await repo.save(Subscriber.create({ id: 's1', publisherId: 'pub-1', contactHandle: '+972500000001', status: 'active' }));

    await useCase.remove({ publisherId: 'pub-1', subscriberId: 's1' });

    const stored = await repo.findById('s1');
    expect(stored!.status).toBe('revoked');
  });

  it('removes the subscriber from the active list', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    await repo.save(Subscriber.create({ id: 's1', publisherId: 'pub-1', contactHandle: '+972500000001', status: 'active' }));

    await useCase.remove({ publisherId: 'pub-1', subscriberId: 's1' });

    const active = await repo.findActiveByPublisher('pub-1');
    expect(active).toHaveLength(0);
  });

  it('throws when the subscriber does not exist', async (): Promise<void> => {
    const { useCase } = makeSut();
    await expect(
      useCase.remove({ publisherId: 'pub-1', subscriberId: 'missing' }),
    ).rejects.toThrow('Subscriber not found');
  });

  it('refuses to remove a subscriber belonging to another publisher', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    await repo.save(Subscriber.create({ id: 's1', publisherId: 'pub-2', contactHandle: '+972500000001', status: 'active' }));

    await expect(
      useCase.remove({ publisherId: 'pub-1', subscriberId: 's1' }),
    ).rejects.toThrow('another publisher');

    const stored = await repo.findById('s1');
    expect(stored!.status).toBe('active'); // unchanged
  });
});
