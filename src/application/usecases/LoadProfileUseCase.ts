import type { PublisherProfile } from '../../domain/entities/PublisherProfile';
import type { IPublisherProfileRepository } from '../../domain/interfaces';

export class LoadProfileUseCase {
  constructor(private readonly profileRepo: IPublisherProfileRepository) {}

  /** Returns the publisher's profile, or null if they haven't set one up yet. */
  async execute(publisherId: string): Promise<PublisherProfile | null> {
    return this.profileRepo.findByPublisher(publisherId);
  }
}
