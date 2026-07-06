import { WhatsAppNotifier } from './WhatsAppNotifier';
import { FakeTwilioClient } from '../../test-support/fakes';
import { Media } from '../../domain/entities/Media';
import { Subscriber } from '../../domain/entities/Subscriber';

const CONTACT = '+972501234567';
const IMAGE_URL = 'https://cdn.test/photo.jpg';
const IMAGE_URL_2 = 'https://cdn.test/photo2.jpg';
const IMAGE_URL_3 = 'https://cdn.test/photo3.jpg';

function makeSubscriber(contactHandle = CONTACT): Subscriber {
  return Subscriber.create({ id: 'sub-1', publisherId: 'user-1', contactHandle, status: 'active' });
}

function makeMedia(url = IMAGE_URL): Media {
  return Media.create({ id: 'media-1', ownerId: 'user-1', url, createdAt: new Date() });
}

function makeSut(publisherName = 'Omer', publisherPhone?: string): { notifier: WhatsAppNotifier; twilio: FakeTwilioClient } {
  const twilio = new FakeTwilioClient();
  const notifier = new WhatsAppNotifier(twilio, publisherName, publisherPhone);
  return { notifier, twilio };
}

describe('WhatsAppNotifier — routing', () => {
  it('sends to the subscriber contact handle', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    await notifier.notify(makeSubscriber('+972509999999'), [makeMedia()]);
    expect(twilio.sent[0]?.to).toBe('+972509999999');
  });

  it('routes all messages in a batch to the same subscriber', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    await notifier.notify(makeSubscriber('+972509999999'), [
      makeMedia(IMAGE_URL),
      makeMedia(IMAGE_URL_2),
      makeMedia(IMAGE_URL_3),
    ]);
    expect(twilio.sent.every(s => s.to === '+972509999999')).toBe(true);
  });
});

describe('WhatsAppNotifier — one message per media item (Twilio WhatsApp limit)', () => {
  it('sends a single item as exactly one message', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    await notifier.notify(makeSubscriber(), [makeMedia(IMAGE_URL)]);
    expect(twilio.sent).toHaveLength(1);
    expect(twilio.sent[0]?.mediaUrl).toBe(IMAGE_URL);
  });

  it('sends two items as two separate messages', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    await notifier.notify(makeSubscriber(), [makeMedia(IMAGE_URL), makeMedia(IMAGE_URL_2)]);
    expect(twilio.sent).toHaveLength(2);
    expect(twilio.sent[0]?.mediaUrl).toBe(IMAGE_URL);
    expect(twilio.sent[1]?.mediaUrl).toBe(IMAGE_URL_2);
  });

  it('sends three items as three separate messages', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    await notifier.notify(makeSubscriber(), [
      makeMedia(IMAGE_URL),
      makeMedia(IMAGE_URL_2),
      makeMedia(IMAGE_URL_3),
    ]);
    expect(twilio.sent).toHaveLength(3);
    expect(twilio.sent[0]?.mediaUrl).toBe(IMAGE_URL);
    expect(twilio.sent[1]?.mediaUrl).toBe(IMAGE_URL_2);
    expect(twilio.sent[2]?.mediaUrl).toBe(IMAGE_URL_3);
  });

  it('puts the caption only on the first message', async (): Promise<void> => {
    const { notifier, twilio } = makeSut('Omer');
    await notifier.notify(makeSubscriber(), [makeMedia(IMAGE_URL), makeMedia(IMAGE_URL_2)]);
    expect(twilio.sent[0]?.body).toContain('Omer');
    expect(twilio.sent[1]?.body).toBe('');
  });

  it('follow-up messages carry no caption regardless of batch size', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    await notifier.notify(makeSubscriber(), [
      makeMedia(IMAGE_URL),
      makeMedia(IMAGE_URL_2),
      makeMedia(IMAGE_URL_3),
    ]);
    expect(twilio.sent[1]?.body).toBe('');
    expect(twilio.sent[2]?.body).toBe('');
  });
});

describe('WhatsAppNotifier — body', () => {
  it('includes the publisher name in the first message body', async (): Promise<void> => {
    const { notifier, twilio } = makeSut('Omer');
    await notifier.notify(makeSubscriber(), [makeMedia()]);
    expect(twilio.sent[0]?.body).toContain('Omer');
  });

  it('includes a wa.me chat link in the first message when publisher phone is set', async (): Promise<void> => {
    const { notifier, twilio } = makeSut('Omer', '+972501234567');
    await notifier.notify(makeSubscriber(), [makeMedia()]);
    expect(twilio.sent[0]?.body).toContain('https://wa.me/972501234567');
  });

  it('omits the chat link when no publisher phone is set', async (): Promise<void> => {
    const { notifier, twilio } = makeSut('Omer');
    await notifier.notify(makeSubscriber(), [makeMedia()]);
    expect(twilio.sent[0]?.body).not.toContain('wa.me');
  });
});

describe('WhatsAppNotifier — error handling', () => {
  it('propagates Twilio API errors from the first message', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    twilio.failOnNextCall();
    await expect(notifier.notify(makeSubscriber(), [makeMedia()])).rejects.toThrow('Twilio error');
  });

  it('propagates Twilio API errors from a follow-up message', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    twilio.failOnCallNumber(2);
    await expect(
      notifier.notify(makeSubscriber(), [makeMedia(IMAGE_URL), makeMedia(IMAGE_URL_2)]),
    ).rejects.toThrow('Twilio error');
  });

  it('propagates network errors', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    twilio.failWithNetworkError();
    await expect(notifier.notify(makeSubscriber(), [makeMedia()])).rejects.toThrow('fetch failed');
  });

  it('propagates rate limit errors (429)', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    twilio.failWithStatus(429);
    await expect(notifier.notify(makeSubscriber(), [makeMedia()])).rejects.toThrow('429');
  });

  it('propagates invalid number errors (400)', async (): Promise<void> => {
    const { notifier, twilio } = makeSut();
    twilio.failWithStatus(400);
    await expect(notifier.notify(makeSubscriber(), [makeMedia()])).rejects.toThrow('400');
  });
});
