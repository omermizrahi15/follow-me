import type { INotifier } from '../../domain/interfaces';
import type { Photo } from '../../domain/entities/Photo';
import type { Subscriber } from '../../domain/entities/Subscriber';

export class WhatsAppNotifier implements INotifier {
  constructor(private readonly apiToken: string) {}

  async notify(subscriber: Subscriber, photo: Photo): Promise<void> {
    // TODO: replace with real WhatsApp API call using this.apiToken
    // e.g. Twilio: client.messages.create({ to: subscriber.contactHandle, body: photo.url })
    void subscriber;
    void photo;
    void this.apiToken;
    return Promise.resolve();
  }
}
