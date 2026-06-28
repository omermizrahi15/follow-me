import type {
  ISubscriberRepository,
  INotificationLog,
  IConfirmationSender,
} from '../../domain/interfaces';
import type { SubscriberDto } from '../dtos';

interface ReactivateInput {
  contactHandle: string;
  publisherName: string;
  detail?: string;
}

interface ReactivateResult {
  reactivated: SubscriberDto[];
}

// Handles a subscriber-initiated opt-in (a START reply). Re-activates every
// previously revoked subscription for the sender's number, records each opt-in
// in the audit log, and sends one confirmation. The mirror image of
// RevokeSubscriberUseCase.
export class ReactivateSubscriberUseCase {
  constructor(
    private readonly subscriberRepo: ISubscriberRepository,
    private readonly notificationLog: INotificationLog,
    private readonly confirmationSender: IConfirmationSender,
  ) {}

  async reactivate(input: ReactivateInput): Promise<ReactivateResult> {
    const subscribers = await this.subscriberRepo.findByContactHandle(input.contactHandle);

    const reactivated: SubscriberDto[] = [];
    for (const subscriber of subscribers) {
      if (subscriber.status !== 'revoked') continue;

      await this.subscriberRepo.save(subscriber.activate());
      await this.notificationLog.record({
        subscriberId: subscriber.id,
        publisherId: subscriber.publisherId,
        contactHandle: subscriber.contactHandle,
        event: 'opt_in',
        ...(input.detail != null ? { detail: input.detail } : {}),
      });
      reactivated.push({
        id: subscriber.id,
        publisherId: subscriber.publisherId,
        contactHandle: subscriber.contactHandle,
        status: 'active',
      });
    }

    if (subscribers.length > 0) {
      await this.confirmationSender.sendResubscribeConfirmation(
        input.contactHandle,
        input.publisherName,
      );
    }

    return { reactivated };
  }
}
