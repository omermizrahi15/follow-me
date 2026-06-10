import { WhatsAppNotifier } from './WhatsAppNotifier';
import { TwilioClientAdapter } from './TwilioClientAdapter';
import { Media } from '../../domain/entities/Media';
import { Subscriber } from '../../domain/entities/Subscriber';

const accountSid = process.env['TWILIO_ACCOUNT_SID'] as string | undefined;
const authToken = process.env['TWILIO_AUTH_TOKEN'] as string | undefined;
const fromNumber = process.env['TWILIO_WHATSAPP_FROM'] as string | undefined;
const testRecipient = process.env['WHATSAPP_TEST_RECIPIENT'] as string | undefined;
const RUN = accountSid && authToken && fromNumber && testRecipient;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

describeIf(RUN)('WhatsAppNotifier (integration)', () => {
  it('sends a WhatsApp message without throwing', async (): Promise<void> => {
    const notifier = new WhatsAppNotifier(
      new TwilioClientAdapter(accountSid!, authToken!, fromNumber!),
      process.env['PUBLISHER_NAME'] as string | undefined ?? 'Follow Me',
    );

    const subscriber = Subscriber.create({
      id: 'sub-test',
      publisherId: 'user-test',
      contactHandle: testRecipient!,
      status: 'active',
    });

    const media = Media.create({
      id: 'media-test',
      ownerId: 'user-test',
      url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      createdAt: new Date(),
    });

    await expect(notifier.notify(subscriber, media)).resolves.not.toThrow();
  });
});
