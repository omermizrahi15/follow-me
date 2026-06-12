import { SaveConfigUseCase } from './SaveConfigUseCase';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import { InMemoryPublisherConfigRepository } from '../../test-support/fakes';

function makeSut(): { useCase: SaveConfigUseCase; repo: InMemoryPublisherConfigRepository } {
  const repo = new InMemoryPublisherConfigRepository();
  const useCase = new SaveConfigUseCase(repo);
  return { useCase, repo };
}

describe('SaveConfigUseCase', () => {
  it('persists the config to the repository', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    const config = PublisherConfig.create({
      publisherId: 'user-1',
      frequency: 'weekly',
      photosPerPost: 3,
      requireApproval: true,
    });
    await useCase.execute(config);
    const saved = await repo.findByPublisher('user-1');
    expect(saved).not.toBeNull();
    expect(saved?.publisherId).toBe('user-1');
    expect(saved?.frequency).toBe('weekly');
  });

  it('overwrites an existing config for the same publisher', async (): Promise<void> => {
    const { useCase, repo } = makeSut();
    const first = PublisherConfig.create({ publisherId: 'user-1', frequency: 'weekly', photosPerPost: 1, requireApproval: true });
    const second = PublisherConfig.create({ publisherId: 'user-1', frequency: 'monthly', photosPerPost: 5, requireApproval: false });
    await useCase.execute(first);
    await useCase.execute(second);
    const saved = await repo.findByPublisher('user-1');
    expect(saved?.frequency).toBe('monthly');
    expect(saved?.photosPerPost).toBe(5);
  });
});
