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

function makeNotifier(): WhatsAppNotifier {
  return new WhatsAppNotifier(new TwilioClientAdapter(accountSid!, authToken!, fromNumber!), 'Omer');
}

function makeSubscriber(): Subscriber {
  return Subscriber.create({ id: 'sub-test', publisherId: 'user-test', contactHandle: testRecipient!, status: 'active' });
}

describeIf(RUN)('WhatsAppNotifier (integration)', () => {
  it('sends a batch of 2 photos + 1 video with location without throwing', async (): Promise<void> => {
    const mediaItems = [
      Media.create({
        id: 'photo-1',
        ownerId: 'user-test',
        url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
        createdAt: new Date(),
        mediaType: 'image',
        location: 'Tel Aviv, Israel',
      }),
      Media.create({
        id: 'photo-2',
        ownerId: 'user-test',
        url: 'https://res.cloudinary.com/demo/image/upload/cld-sample.jpg',
        createdAt: new Date(),
        mediaType: 'image',
        location: 'Tel Aviv, Israel',
      }),
      Media.create({
        id: 'video-1',
        ownerId: 'user-test',
        url: 'https://res.cloudinary.com/demo/video/upload/dog.mp4',
        createdAt: new Date(),
        mediaType: 'video',
        location: 'Tel Aviv, Israel',
      }),
    ];

    await expect(makeNotifier().notify(makeSubscriber(), mediaItems)).resolves.not.toThrow();
  });
});
