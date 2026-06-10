import type { INotifier } from '../../domain/interfaces';
import type { Media } from '../../domain/entities/Media';
import type { Subscriber } from '../../domain/entities/Subscriber';

export interface ITwilioClient {
  sendWhatsApp(to: string, body: string, mediaUrl?: string): Promise<void>;
}

export class WhatsAppNotifier implements INotifier {
  constructor(
    private readonly client: ITwilioClient,
    private readonly publisherName: string,
  ) {}

  async notify(subscriber: Subscriber, media: Media): Promise<void> {
    const locationPart = media.location != null ? ` from ${media.location}` : '';
    const body = `Checkout ${this.publisherName} latest photos${locationPart} 📸`;
    await this.client.sendWhatsApp(subscriber.contactHandle, body, media.url);
  }
}
