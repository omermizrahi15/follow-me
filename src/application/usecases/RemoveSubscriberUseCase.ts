import type { ISubscriberRepository } from '../../domain/interfaces';

interface RemoveSubscriberInput {
  publisherId: string;
  subscriberId: string;
}

export class RemoveSubscriberUseCase {
  constructor(private readonly subscriberRepo: ISubscriberRepository) {}

  async remove(input: RemoveSubscriberInput): Promise<void> {
    const subscriber = await this.subscriberRepo.findById(input.subscriberId);
    if (subscriber == null) {
      throw new Error('Subscriber not found');
    }
    if (subscriber.publisherId !== input.publisherId) {
      throw new Error('Cannot remove a subscriber belonging to another publisher');
    }

    await this.subscriberRepo.save(subscriber.revoke());
  }
}
