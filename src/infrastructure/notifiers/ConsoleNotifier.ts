import type { INotifier, IConfirmationSender } from '../../domain/interfaces';
import type { Media } from '../../domain/entities/Media';
import type { Subscriber } from '../../domain/entities/Subscriber';
import { composeNotificationBody } from '../../domain/services/notificationBody';

export class ConsoleNotifier implements INotifier {
  constructor(
    private readonly publisherName: string,
    private readonly publisherPhone?: string,
  ) {}

  notify(subscriber: Subscriber, media: Media[]): Promise<void> {
    const body = composeNotificationBody(this.publisherName, media, this.publisherPhone);
    console.log(`[ConsoleNotifier] → ${subscriber.contactHandle}`);
    console.log(`  body: ${body}`);
    media.forEach((m, i) => console.log(`  [${i}] ${m.mediaType} ${m.url}`));
    return Promise.resolve();
  }
}

export class ConsoleConfirmationSender implements IConfirmationSender {
  sendWelcome(contactHandle: string, publisherName: string): Promise<void> {
    console.log(`[ConsoleConfirmationSender] welcome → ${contactHandle} (publisher: ${publisherName})`);
    return Promise.resolve();
  }
}
