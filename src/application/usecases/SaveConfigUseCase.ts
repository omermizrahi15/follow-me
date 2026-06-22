import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { IPublisherConfigRepository } from '../../domain/interfaces';

export class SaveConfigUseCase {
  constructor(private readonly configRepo: IPublisherConfigRepository) {}

  async execute(config: PublisherConfig): Promise<void> {
    await this.configRepo.save(config);
  }
}
