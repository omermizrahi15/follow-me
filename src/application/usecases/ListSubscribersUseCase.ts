import type { ISubscriberRepository } from '../../domain/interfaces';
import type { SubscriberDto } from '../dtos';

export class ListSubscribersUseCase {
  constructor(private readonly subscriberRepo: ISubscriberRepository) {}

  async list(publisherId: string): Promise<SubscriberDto[]> {
    const subscribers = await this.subscriberRepo.findActiveByPublisher(publisherId);
    return subscribers.map(s => ({
      id: s.id,
      publisherId: s.publisherId,
      contactHandle: s.contactHandle,
      status: s.status,
    }));
  }
}
