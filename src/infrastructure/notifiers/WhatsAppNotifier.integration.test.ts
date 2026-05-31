/**
 * Integration test — hits the real WhatsApp API.
 * Requires WHATSAPP_API_TOKEN and WHATSAPP_TEST_RECIPIENT env vars.
 * Run with: jest --testPathPattern=WhatsAppNotifier.integration
 */
import { WhatsAppNotifier } from './WhatsAppNotifier';
import { Photo } from '../../domain/entities/Photo';
import { Subscriber } from '../../domain/entities/Subscriber';

const RUN = process.env.WHATSAPP_API_TOKEN && process.env.WHATSAPP_TEST_RECIPIENT;

// Skip in CI unless env vars are present
const describeIf = (cond: unknown) => cond ? describe : describe.skip;

describeIf(RUN)('WhatsAppNotifier (integration)', () => {
  const notifier = new WhatsAppNotifier(process.env.WHATSAPP_API_TOKEN!);

  const subscriber = Subscriber.create({
    id: 'sub-test',
    publisherId: 'user-test',
    contactHandle: process.env.WHATSAPP_TEST_RECIPIENT!,
    status: 'active',
  });

  const photo = Photo.create({
    id: 'photo-test',
    ownerId: 'user-test',
    url: 'https://example.com/test-photo.jpg',
    createdAt: new Date(),
  });

  it('sends a WhatsApp message without throwing', async () => {
    await expect(notifier.notify(subscriber, photo)).resolves.not.toThrow();
  });
});
