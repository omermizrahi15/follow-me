import { INotifier } from '../../domain/interfaces';
import { Photo } from '../../domain/entities/Photo';
import { Subscriber } from '../../domain/entities/Subscriber';

// Wraps whichever WhatsApp API you choose (Twilio, Meta Cloud API, etc.)
// Swap the inner client without touching INotifier or any use case.
export class WhatsAppNotifier implements INotifier {
  constructor(private readonly apiToken: string) {}

  async notify(subscriber: Subscriber, photo: Photo): Promise<void> {
    // TODO: replace with real WhatsApp API call
    // e.g. Twilio: client.messages.create({ to: subscriber.contactHandle, ... })
    const message = `New photo from your subscription: ${photo.url}`;
    console.log(`[WhatsApp] → ${subscriber.contactHandle}: ${message}`);
    throw new Error('WhatsAppNotifier.notify not yet implemented');
  }
}
