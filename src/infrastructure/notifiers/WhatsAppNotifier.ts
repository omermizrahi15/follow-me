import type { INotifier } from '../../domain/interfaces';
import type { Media } from '../../domain/entities/Media';
import type { Subscriber } from '../../domain/entities/Subscriber';
import { composeNotificationBody } from '../../domain/services/notificationBody';

export interface ITwilioClient {
  sendWhatsApp(to: string, body: string, mediaUrl?: string): Promise<void>;
}

export class WhatsAppNotifier implements INotifier {
  constructor(
    private readonly client: ITwilioClient,
    private readonly publisherName: string,
    private readonly publisherPhone?: string,
  ) {}

  async notify(subscriber: Subscriber, media: Media[]): Promise<void> {
    const body = composeNotificationBody(this.publisherName, media, this.publisherPhone);
    const [first, ...rest] = media;

    // Twilio WhatsApp only supports one MediaUrl per request.
    // First message carries the caption; follow-ups carry only the media.
    await this.client.sendWhatsApp(subscriber.contactHandle, body, first?.url);

    for (const item of rest) {
      await this.client.sendWhatsApp(subscriber.contactHandle, '', item.url);
    }
  }
}
