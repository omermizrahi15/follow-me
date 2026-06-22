import { Subscriber } from '../../domain/entities/Subscriber';
import type { ISubscriberRepository, IConfirmationSender } from '../../domain/interfaces';
import type { SubscriberDto } from '../dtos';

interface SubscribeInput {
  subscriberId: string;
  publisherId: string;
  publisherName: string;
  contactHandle: string;
}

export class SubscribeUseCase {
  constructor(
    private readonly subscriberRepo: ISubscriberRepository,
    private readonly confirmationSender?: IConfirmationSender,
  ) {}

  async subscribe(input: SubscribeInput): Promise<SubscriberDto> {
    // Check for an existing subscription (active or revoked)
    const existing = await this.subscriberRepo.findByPublisherAndContact(
      input.publisherId,
      input.contactHandle,
    );

    let subscriber: Subscriber;

    if (existing != null) {
      if (existing.isActive()) {
        // Already subscribed — return as-is without sending another confirmation
        return {
          id: existing.id,
          publisherId: existing.publisherId,
          contactHandle: existing.contactHandle,
          status: existing.status,
        };
      }
      // Re-activate a previously revoked subscription
      subscriber = existing.activate();
    } else {
      subscriber = Subscriber.create({
        id: input.subscriberId,
        publisherId: input.publisherId,
        contactHandle: input.contactHandle,
        status: 'active',
      });
    }

    await this.subscriberRepo.save(subscriber);

    await this.confirmationSender?.sendWelcome(subscriber.contactHandle, input.publisherName);

    return {
      id: subscriber.id,
      publisherId: subscriber.publisherId,
      contactHandle: subscriber.contactHandle,
      status: subscriber.status,
    };
  }
}
