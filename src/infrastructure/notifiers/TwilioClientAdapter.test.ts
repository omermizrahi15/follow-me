import { TwilioClientAdapter, TwilioSendError } from './TwilioClientAdapter';

const CONTACT = '+972501234567';
const noSleep = (): Promise<void> => Promise.resolve();

function makeAdapter(maxRetries = 3): TwilioClientAdapter {
  return new TwilioClientAdapter('AC123', 'token', '+14155238886', { maxRetries, sleep: noSleep });
}

function twilioOk(): Response {
  return new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 });
}

describe('TwilioClientAdapter retry behaviour', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('retries transient failures and succeeds — fails twice (429) then succeeds', async (): Promise<void> => {
    fetchMock
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(twilioOk());

    await expect(makeAdapter().sendWhatsApp(CONTACT, 'hi')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries 5xx responses', async (): Promise<void> => {
    fetchMock
      .mockResolvedValueOnce(new Response('twilio down', { status: 503 }))
      .mockResolvedValueOnce(twilioOk());

    await makeAdapter().sendWhatsApp(CONTACT, 'hi');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries network errors (fetch rejects)', async (): Promise<void> => {
    fetchMock
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(twilioOk());

    await makeAdapter().sendWhatsApp(CONTACT, 'hi');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry permanent failures (400 invalid number)', async (): Promise<void> => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('invalid To', { status: 400 })));

    const err = await makeAdapter().sendWhatsApp(CONTACT, 'hi').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TwilioSendError);
    expect((err as TwilioSendError).permanent).toBe(true);
    expect((err as TwilioSendError).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry 403 (unsubscribed recipient)', async (): Promise<void> => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('forbidden', { status: 403 })));

    const err = await makeAdapter().sendWhatsApp(CONTACT, 'hi').catch((e: unknown) => e);
    expect((err as TwilioSendError).permanent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries transient failures with a non-permanent error', async (): Promise<void> => {
    // A fresh Response per call — a body can only be read once.
    fetchMock.mockImplementation(() => Promise.resolve(new Response('rate limited', { status: 429 })));

    const err = await makeAdapter(3).sendWhatsApp(CONTACT, 'hi').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TwilioSendError);
    expect((err as TwilioSendError).permanent).toBe(false);
    // 1 initial attempt + 3 retries
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('backs off exponentially between retries', async (): Promise<void> => {
    const delays: number[] = [];
    const adapter = new TwilioClientAdapter('AC123', 'token', '+14155238886', {
      maxRetries: 3,
      baseDelayMs: 500,
      sleep: ms => { delays.push(ms); return Promise.resolve(); },
    });
    fetchMock
      .mockResolvedValueOnce(new Response('x', { status: 500 }))
      .mockResolvedValueOnce(new Response('x', { status: 500 }))
      .mockResolvedValueOnce(new Response('x', { status: 500 }))
      .mockResolvedValueOnce(twilioOk());

    await adapter.sendWhatsApp(CONTACT, 'hi');
    expect(delays).toEqual([500, 1000, 2000]);
  });
});
