import type {
  ISubscriberRepository,
  INotificationLog,
  IConfirmationSender,
} from '../../domain/interfaces';
import type { SubscriberDto } from '../dtos';

interface RevokeInput {
  // The sender's phone number (E.164), the only thing an inbound STOP gives us.
  contactHandle: string;
  // Display name used in the confirmation reply, resolved by the caller.
  publisherName: string;
  // Optional raw command word (e.g. "STOP") recorded on the audit entry.
  detail?: string;
}

interface RevokeResult {
  revoked: SubscriberDto[];
}

// Handles a subscriber-initiated opt-out (a STOP / UNSUBSCRIBE reply). Revokes
// every active subscription for the sender's number, records each opt-out in the
// audit log, and sends one confirmation. Idempotent: a repeat STOP from an
// already-revoked (but known) number still acknowledges, and writes nothing.
//
// Distinct from RemoveSubscriberUseCase, which is the publisher removing a
// follower by id. Here the subscriber removes themselves by phone number.
export class RevokeSubscriberUseCase {
  constructor(
    private readonly subscriberRepo: ISubscriberRepository,
    private readonly notificationLog: INotificationLog,
    private readonly confirmationSender: IConfirmationSender,
  ) {}

  async revoke(input: RevokeInput): Promise<RevokeResult> {
    const subscribers = await this.subscriberRepo.findByContactHandle(input.contactHandle);

    const revoked: SubscriberDto[] = [];
    for (const subscriber of subscribers) {
      if (!subscriber.isActive()) continue;

      await this.subscriberRepo.save(subscriber.revoke());
      await this.notificationLog.record({
        subscriberId: subscriber.id,
        publisherId: subscriber.publisherId,
        contactHandle: subscriber.contactHandle,
        event: 'opt_out',
        ...(input.detail != null ? { detail: input.detail } : {}),
      });
      revoked.push({
        id: subscriber.id,
        publisherId: subscriber.publisherId,
        contactHandle: subscriber.contactHandle,
        status: 'revoked',
      });
    }

    // Acknowledge any STOP from a number we recognise, even a repeat — that's
    // the compliant, reassuring behaviour. Stay silent for unknown numbers.
    if (subscribers.length > 0) {
      await this.confirmationSender.sendUnsubscribeConfirmation(
        input.contactHandle,
        input.publisherName,
      );
    }

    return { revoked };
  }
}
