import { SubscribeUseCase } from './SubscribeUseCase';
import { Subscriber } from '../../domain/entities/Subscriber';
import { InMemorySubscriberRepository, InMemoryConfirmationSender } from '../../test-support/fakes';

function makeSut(): {
  useCase: SubscribeUseCase;
  repo: InMemorySubscriberRepository;
  confirmation: InMemoryConfirmationSender;
} {
  const repo = new InMemorySubscriberRepository();
  const confirmation = new InMemoryConfirmationSender();
  const useCase = new SubscribeUseCase(repo, confirmation);
  return { useCase, repo, confirmation };
}

const baseInput = {
  subscriberId: 'sub-1',
  publisherId: 'user-1',
  publisherName: 'Alice',
  contactHandle: '+972501234567',
};

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

  it('sends a confirmation welcome message on first subscribe', async (): Promise<void> => {
    const { useCase, confirmation } = makeSut();
    await useCase.subscribe(baseInput);
    expect(confirmation.wasWelcomedAt('+972501234567')).toBe(true);
    expect(confirmation.sent[0]?.publisherName).toBe('Alice');
  });

  it('re-activates a revoked subscriber and sends confirmation', async (): Promise<void> => {
    const { useCase, repo, confirmation } = makeSut();

    // Seed a revoked subscriber
    const revoked = Subscriber.create({ ...baseInput, id: 'sub-1', status: 'revoked' }).revoke();
    await repo.save(revoked);

    const dto = await useCase.subscribe({ ...baseInput, subscriberId: 'sub-new' });

    expect(dto.status).toBe('active');
    expect(repo.all()).toHaveLength(1); // no duplicate created
    expect(confirmation.wasWelcomedAt('+972501234567')).toBe(true);
  });

  it('is idempotent when subscriber is already active — no duplicate and no extra welcome', async (): Promise<void> => {
    const { useCase, repo, confirmation } = makeSut();

    await useCase.subscribe(baseInput);
    await useCase.subscribe({ ...baseInput, subscriberId: 'sub-2' });

    expect(repo.all()).toHaveLength(1);
    // Welcome should only be sent once
    expect(confirmation.sent).toHaveLength(1);
  });
});
