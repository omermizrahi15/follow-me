import { WhatsAppEdgeNotifier } from './WhatsAppEdgeNotifier';
import { Media } from '../../domain/entities/Media';
import { Subscriber } from '../../domain/entities/Subscriber';

const FN_URL = 'https://test.supabase.co/functions/v1/send-post';
const KEY = 'anon-key';
const CONTACT = '+972501234567';

function makeSubscriber(contactHandle = CONTACT): Subscriber {
  return Subscriber.create({ id: 'sub-1', publisherId: 'user-1', contactHandle, status: 'active' });
}

function makeMedia(url = 'https://cdn.test/photo.jpg'): Media {
  return Media.create({ id: 'media-1', ownerId: 'user-1', url, createdAt: new Date() });
}

describe('WhatsAppEdgeNotifier', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sent: 1 }), { status: 200 }),
    );
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('POSTs publisherId, subscriber handle and media urls to the function', async (): Promise<void> => {
    const notifier = new WhatsAppEdgeNotifier(FN_URL, KEY);
    await notifier.notify(makeSubscriber(), [
      makeMedia('https://cdn.test/a.jpg'),
      makeMedia('https://cdn.test/b.jpg'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(FN_URL);
    expect(JSON.parse(init.body as string)).toEqual({
      publisherId: 'user-1',
      to: CONTACT,
      mediaUrls: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'],
    });
  });

  it('sends the posting id so the gallery row can be trashed with the post', async (): Promise<void> => {
    const media = Media.create({
      id: 'media-1',
      ownerId: 'user-1',
      url: 'https://cdn.test/a.jpg',
      createdAt: new Date(),
      postingId: 'posting-abc',
      location: 'Lisbon, Portugal',
    });
    const notifier = new WhatsAppEdgeNotifier(FN_URL, KEY);
    await notifier.notify(makeSubscriber(), [media]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      place: 'Lisbon, Portugal',
      postingId: 'posting-abc',
    });
  });

  it('authenticates with the anon key', async (): Promise<void> => {
    const notifier = new WhatsAppEdgeNotifier(FN_URL, KEY);
    await notifier.notify(makeSubscriber(), [makeMedia()]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${KEY}`);
    expect(headers['apikey']).toBe(KEY);
  });

  it('does not call the function when the batch is empty', async (): Promise<void> => {
    const notifier = new WhatsAppEdgeNotifier(FN_URL, KEY);
    await notifier.notify(makeSubscriber(), []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws with status and body when the function fails', async (): Promise<void> => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 502 }));
    const notifier = new WhatsAppEdgeNotifier(FN_URL, KEY);
    await expect(notifier.notify(makeSubscriber(), [makeMedia()])).rejects.toThrow(
      'send-post failed (502): boom',
    );
  });
});
