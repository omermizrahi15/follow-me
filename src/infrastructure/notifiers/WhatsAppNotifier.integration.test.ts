import { WhatsAppNotifier } from './WhatsAppNotifier';
import { Photo } from '../../domain/entities/Photo';
import { Subscriber } from '../../domain/entities/Subscriber';

const apiToken = (process.env['WHATSAPP_API_TOKEN'] ?? '') as string;
const testRecipient = (process.env['WHATSAPP_TEST_RECIPIENT'] ?? '') as string;
const RUN = apiToken && testRecipient;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

describeIf(RUN)('WhatsAppNotifier (integration)', () => {
  const notifier = new WhatsAppNotifier(apiToken);

  const subscriber = Subscriber.create({
    id: 'sub-test',
    publisherId: 'user-test',
    contactHandle: testRecipient,
    status: 'active',
  });

  const photo = Photo.create({
    id: 'photo-test',
    ownerId: 'user-test',
    url: 'https://example.com/test-photo.jpg',
    createdAt: new Date(),
  });

  it('sends a WhatsApp message without throwing', async (): Promise<void> => {
    await expect(notifier.notify(subscriber, photo)).resolves.not.toThrow();
  });
});