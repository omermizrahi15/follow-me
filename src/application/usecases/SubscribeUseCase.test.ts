import { SubscribeUseCase } from './SubscribeUseCase';
import { InMemorySubscriberRepository } from '../../test-support/fakes';

function makeSut(): { useCase: SubscribeUseCase; repo: InMemorySubscriberRepository } {
  const repo = new InMemorySubscriberRepository();
  const useCase = new SubscribeUseCase(repo);
  return { useCase, repo };
}

const baseInput = { subscriberId: 'sub-1', publisherId: 'user-1', contactHandle: '+972501234567' };

describe('SubscribeUseCase', () => {
  it('creates an active subscriber', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    const dto = await useCase.subscribe(baseInput);
    expect(dto.status).toBe('active');
    expect(repo.all()).toHaveLength(1);
  });

  it('returns the correct contact handle', async (): Promise<void> => {
    const { useCase } = makeSut();
    const dto = await useCase.subscribe(baseInput);
    expect(dto.contactHandle).toBe('+972501234567');
  });

  it('persists the subscriber for future lookups', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    await useCase.subscribe(baseInput);
    const found = await repo.findById('sub-1');
    expect(found).not.toBeNull();
    expect(found!.isActive()).toBe(true);
  });
});
