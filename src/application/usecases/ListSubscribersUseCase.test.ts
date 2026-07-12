import { ListSubscribersUseCase } from './ListSubscribersUseCase';
import { Subscriber } from '../../domain/entities/Subscriber';
import { InMemorySubscriberRepository } from '../../test-support/fakes';

function makeSut(): { useCase: ListSubscribersUseCase; repo: InMemorySubscriberRepository } {
  const repo = new InMemorySubscriberRepository();
  const useCase = new ListSubscribersUseCase(repo);
  return { useCase, repo };
}

describe('ListSubscribersUseCase', () => {
  it('returns active subscribers for the publisher', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    await repo.save(Subscriber.create({ id: 's1', publisherId: 'pub-1', contactHandle: '+972500000001', status: 'active' }));
    await repo.save(Subscriber.create({ id: 's2', publisherId: 'pub-1', contactHandle: '+972500000002', status: 'active' }));

    const result = await useCase.list('pub-1');

    expect(result).toHaveLength(2);
    expect(result.map(s => s.contactHandle)).toEqual(
      expect.arrayContaining(['+972500000001', '+972500000002']),
    );
  });

  it('excludes revoked subscribers', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    await repo.save(Subscriber.create({ id: 's1', publisherId: 'pub-1', contactHandle: '+972500000001', status: 'active' }));
    await repo.save(Subscriber.create({ id: 's2', publisherId: 'pub-1', contactHandle: '+972500000002', status: 'revoked' }));

    const result = await useCase.list('pub-1');

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('s1');
  });

  it('includes unreachable subscribers so the publisher can see them', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    await repo.save(Subscriber.create({ id: 's1', publisherId: 'pub-1', contactHandle: '+972500000001', status: 'active' }));
    await repo.save(Subscriber.create({ id: 's2', publisherId: 'pub-1', contactHandle: '+972500000002', status: 'unreachable' }));

    const result = await useCase.list('pub-1');

    expect(result).toHaveLength(2);
    expect(result.find(s => s.id === 's2')?.status).toBe('unreachable');
  });

  it('does not return subscribers belonging to other publishers', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    await repo.save(Subscriber.create({ id: 's1', publisherId: 'pub-1', contactHandle: '+972500000001', status: 'active' }));
    await repo.save(Subscriber.create({ id: 's2', publisherId: 'pub-2', contactHandle: '+972500000002', status: 'active' }));

    const result = await useCase.list('pub-1');

    expect(result).toHaveLength(1);
    expect(result[0]?.publisherId).toBe('pub-1');
  });

  it('returns an empty list when the publisher has no subscribers', async (): Promise<void> => {
    const { useCase } = makeSut();
    const result = await useCase.list('pub-1');
    expect(result).toEqual([]);
  });
});
