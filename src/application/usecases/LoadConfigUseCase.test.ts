import { LoadConfigUseCase } from './LoadConfigUseCase';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import { InMemoryPublisherConfigRepository } from '../../test-support/fakes';

function makeSut(): { useCase: LoadConfigUseCase; repo: InMemoryPublisherConfigRepository } {
  const repo = new InMemoryPublisherConfigRepository();
  const useCase = new LoadConfigUseCase(repo);
  return { useCase, repo };
}

describe('LoadConfigUseCase', () => {
  it('returns the stored config when one exists', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    const stored = PublisherConfig.create({
      publisherId: 'user-1',
      frequency: 'biweekly',
      photosPerPost: 5,
      requireApproval: false,
    });
    await repo.save(stored);
    const config = await useCase.execute('user-1');
    expect(config.frequency).toBe('biweekly');
    expect(config.photosPerPost).toBe(5);
    expect(config.requireApproval).toBe(false);
  });

  it('returns defaults when no config exists', async (): Promise<void> => {
    const { useCase } = makeSut();
    const config = await useCase.execute('user-1');
    expect(config.publisherId).toBe('user-1');
    expect(config.frequency).toBe('weekly');
    expect(config.photosPerPost).toBe(5);
    expect(config.requireApproval).toBe(true);
  });

  it('returns defaults for a different publisher than one stored', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    await repo.save(PublisherConfig.create({ publisherId: 'user-1', frequency: 'monthly', photosPerPost: 10, requireApproval: false }));
    const config = await useCase.execute('user-2');
    expect(config.publisherId).toBe('user-2');
    expect(config.frequency).toBe('weekly');
  });
});
