import type { ISubscriberRepository } from '../../domain/interfaces';
import type { SubscriberDto } from '../dtos';

export class ListSubscribersUseCase {
  constructor(private readonly subscriberRepo: ISubscriberRepository) {}

  async list(publisherId: string): Promise<SubscriberDto[]> {
    // Unreachable numbers stay visible so the publisher knows delivery is
    // failing (issue #24); revoked (opted-out) subscriptions stay hidden.
    const subscribers = (await this.subscriberRepo.findByPublisher(publisherId))
      .filter(s => s.isActive() || s.isUnreachable());
    return subscribers.map(s => ({
      id: s.id,
      publisherId: s.publisherId,
      contactHandle: s.contactHandle,
      status: s.status,
    }));
  }
}
