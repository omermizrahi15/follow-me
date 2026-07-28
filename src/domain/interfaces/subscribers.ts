import type { Subscriber } from '../entities/Subscriber';

export interface ISubscriberRepository {
  save(subscriber: Subscriber): Promise<void>;
  findActiveByPublisher(publisherId: string): Promise<Subscriber[]>;
  /** Every subscription of the publisher regardless of status — the Followers
   *  list needs revoked filtered out but unreachable shown (issue #24). */
  findByPublisher(publisherId: string): Promise<Subscriber[]>;
  findById(id: string): Promise<Subscriber | null>;
  findByPublisherAndContact(publisherId: string, contactHandle: string): Promise<Subscriber | null>;
  // Every subscription tied to a phone number, across publishers. Used to act on
  // an inbound STOP/START where we only know the sender's number.
  findByContactHandle(contactHandle: string): Promise<Subscriber[]>;
}

export interface IConfirmationSender {
  sendWelcome(contactHandle: string, publisherName: string): Promise<void>;
  sendUnsubscribeConfirmation(contactHandle: string, publisherName: string): Promise<void>;
  sendResubscribeConfirmation(contactHandle: string, publisherName: string): Promise<void>;
}
