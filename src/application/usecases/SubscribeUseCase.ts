import { Subscriber } from '../../domain/entities/Subscriber';
import { ISubscriberRepository } from '../../domain/interfaces';
import { SubscriberDto } from '../dtos';

interface SubscribeInput {
  subscriberId: string;
  publisherId: string;
  contactHandle: string;
}

export class SubscribeUseCase {
  constructor(private readonly subscriberRepo: ISubscriberRepository) {}

  async execute(input: SubscribeInput): Promise<SubscriberDto> {
    const subscriber = Subscriber.create({
      id: input.subscriberId,
      publisherId: input.publisherId,
      contactHandle: input.contactHandle,
      status: 'active', // MVP: auto-approve; add approval flow later
    });

    await this.subscriberRepo.save(subscriber);

    return {
      id: subscriber.id,
      publisherId: subscriber.publisherId,
      contactHandle: subscriber.contactHandle,
      status: subscriber.status,
    };
  }
}
