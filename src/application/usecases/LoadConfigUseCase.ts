import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { IPublisherConfigRepository } from '../../domain/interfaces';

export class LoadConfigUseCase {
  constructor(private readonly configRepo: IPublisherConfigRepository) {}

  async execute(publisherId: string): Promise<PublisherConfig> {
    const config = await this.configRepo.findByPublisher(publisherId);
    if (config != null) return config;
    return PublisherConfig.create({
      publisherId,
      frequency: 'weekly',
      photosPerPost: 3,
      requireApproval: true,
    });
  }
}
