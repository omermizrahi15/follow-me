import type { IConfirmationSender } from '../../domain/interfaces';
import type { ITwilioClient } from './WhatsAppNotifier';
import {
  composeUnsubscribeConfirmation,
  composeResubscribeConfirmation,
} from '../../domain/services/optOutMessages';

export class WhatsAppConfirmationSender implements IConfirmationSender {
  constructor(private readonly client: ITwilioClient) {}

  async sendWelcome(contactHandle: string, publisherName: string): Promise<void> {
    const body =
      `You're now following ${publisherName}. Reply STOP at any time to unsubscribe.`;
    await this.client.sendWhatsApp(contactHandle, body);
  }

  async sendUnsubscribeConfirmation(contactHandle: string, publisherName: string): Promise<void> {
    await this.client.sendWhatsApp(contactHandle, composeUnsubscribeConfirmation(publisherName));
  }

  async sendResubscribeConfirmation(contactHandle: string, publisherName: string): Promise<void> {
    await this.client.sendWhatsApp(contactHandle, composeResubscribeConfirmation(publisherName));
  }
}
