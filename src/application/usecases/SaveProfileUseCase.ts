import type { PublisherProfile } from '../../domain/entities/PublisherProfile';
import type { IPublisherProfileRepository } from '../../domain/interfaces';

export class SaveProfileUseCase {
  constructor(private readonly profileRepo: IPublisherProfileRepository) {}

  async execute(profile: PublisherProfile): Promise<void> {
    await this.profileRepo.save(profile);
  }
}
