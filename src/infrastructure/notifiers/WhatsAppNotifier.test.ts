import { WhatsAppNotifier } from './WhatsAppNotifier';
import { FakeTwilioClient } from '../../test-support/fakes';
import { Media } from '../../domain/entities/Media';
import { Subscriber } from '../../domain/entities/Subscriber';

const PUBLISHER_NAME = 'Omer';
const CONTACT = '+972501234567';
const IMAGE_URL = 'https://cdn.test/photo.jpg';
const VIDEO_URL = 'https://cdn.test/video.mp4';

function makeSubscriber(contactHandle = CONTACT): Subscriber {
  return Subscriber.create({ id: 'sub-1', publisherId: 'user-1', contactHandle, status: 'active' });
}

function makeMedia(overrides: Partial<{ url: string; location: string; mediaType: 'image' | 'video' }> = {}): Media {
  return Media.create({
    id: 'media-1',
    ownerId: 'user-1',
    url: overrides.url ?? IMAGE_URL,
    createdAt: new Date(),
    ...(overrides.location != null ? { location: overrides.location } : {}),
    mediaType: overrides.mediaType ?? 'image',
  });
}

function makeSut(publisherName = PUBLISHER_NAME): { notifier: WhatsAppNotifier; twilio: FakeTwilioClient } {
  const twilio = new FakeTwilioClient();
  const notifier = new WhatsAppNotifier(twilio, publisherName);
  return { notifier, twilio };
}

describe('WhatsAppNotifier — routing', () => {
  it('sends to the subscriber contact handle', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    await notifier.notify(makeSubscriber('+972509999999'), makeMedia());
    expect(twilio.sent[0]?.to).toBe('+972509999999');
  });
});

describe('WhatsAppNotifier — media', () => {
  it('sends a photo as an embedded MediaUrl', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    await notifier.notify(makeSubscriber(), makeMedia({ url: IMAGE_URL }));
    expect(twilio.sent[0]?.mediaUrl).toBe(IMAGE_URL);
  });

  it('sends a video as an embedded MediaUrl', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    await notifier.notify(makeSubscriber(), makeMedia({ url: VIDEO_URL, mediaType: 'video' }));
    expect(twilio.sent[0]?.mediaUrl).toBe(VIDEO_URL);
  });
});

describe('WhatsAppNotifier — message body', () => {
  it('includes the publisher name', async (): Promise<void> => {
    const { notifier, twilio } = makeSut('Omer');
    await notifier.notify(makeSubscriber(), makeMedia());
    expect(twilio.sent[0]?.body).toContain('Omer');
  });

  it('includes location when the media has a location', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    await notifier.notify(makeSubscriber(), makeMedia({ location: 'Tel Aviv, Israel' }));
    expect(twilio.sent[0]?.body).toContain('Tel Aviv, Israel');
  });

  it('omits location when the media has no location', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    await notifier.notify(makeSubscriber(), makeMedia());
    expect(twilio.sent[0]?.body).not.toContain('from');
  });

  it('uses "checkout" phrasing', async (): Promise<void> => {
    const { notifier, twilio } = makeSut('Dana');
    await notifier.notify(makeSubscriber(), makeMedia({ location: 'Paris, France' }));
    expect(twilio.sent[0]?.body).toMatch(/checkout Dana.*latest.*Paris, France/i);
  });
});

describe('WhatsAppNotifier — error handling', () => {
  it('propagates Twilio API errors', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    twilio.failOnNextCall();
    await expect(notifier.notify(makeSubscriber(), makeMedia())).rejects.toThrow('Twilio error');
  });

  it('propagates network errors reaching Twilio', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    twilio.failWithNetworkError();
    await expect(notifier.notify(makeSubscriber(), makeMedia())).rejects.toThrow('fetch failed');
  });

  it('propagates rate limit errors (429)', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    twilio.failWithStatus(429);
    await expect(notifier.notify(makeSubscriber(), makeMedia())).rejects.toThrow('429');
  });

  it('propagates invalid number errors (400)', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    twilio.failWithStatus(400);
    await expect(notifier.notify(makeSubscriber(), makeMedia())).rejects.toThrow('400');
  });
});
