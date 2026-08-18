/**
 * Tests for the Twilio client behind the PRODUCTION WhatsApp send path
 * (send-post / auto-post / subscribe). One module, two runtimes: the Edge
 * Functions import it directly and there is a matching Deno suite in
 * supabase/functions/_shared/twilioClient_test.ts.
 *
 * Covers issue #24's retry acceptance criterion: transient Twilio errors are
 * retried with exponential back-off (a mock that fails twice then succeeds),
 * permanent failures are never retried, and the message SID is surfaced for
 * delivery tracking.
 */
import {
  sendWhatsApp,
  sendBatch,
  TwilioSendError,
  type TwilioCreds,
} from '../notifiers/twilioClient';
import {
  isFailureStatus,
  isUnreachableErrorCode,
} from '../../../supabase/functions/_shared/messageLog';

const CONTACT = '+972501234567';
const CREDS: TwilioCreds = { accountSid: 'AC123', authToken: 'token', fromNumber: '+14155238886' };
const noSleep = (): Promise<void> => Promise.resolve();

function twilioAccepted(sid = 'SM123'): Response {
  return new Response(JSON.stringify({ sid, status: 'queued' }), { status: 201 });
}

function twilioError(status: number, code?: number): Response {
  return new Response(JSON.stringify({ code: code ?? null, message: 'boom' }), { status });
}

describe('sendWhatsApp (twilioClient)', () => {
  it('retries and succeeds when Twilio fails twice with 429 then accepts', async (): Promise<void> => {
    const fetchImpl = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(twilioError(429))
      .mockResolvedValueOnce(twilioError(429))
      .mockResolvedValueOnce(twilioAccepted('SM777'));

    const result = await sendWhatsApp(CREDS, CONTACT, 'hello', undefined, {
      sleep: noSleep,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.sid).toBe('SM777');
  });

  it('retries 5xx and network errors', async (): Promise<void> => {
    const fetchImpl = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(twilioError(503))
      .mockResolvedValueOnce(twilioAccepted());

    await sendWhatsApp(CREDS, CONTACT, 'hello', undefined, {
      sleep: noSleep,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('throws a permanent TwilioSendError on 400 without retrying, exposing the Twilio code', async (): Promise<void> => {
    const fetchImpl = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockImplementation(() => Promise.resolve(twilioError(400, 21211)));

    const err = await sendWhatsApp(CREDS, CONTACT, 'hello', undefined, {
      sleep: noSleep,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TwilioSendError);
    expect((err as TwilioSendError).permanent).toBe(true);
    expect((err as TwilioSendError).status).toBe(400);
    expect((err as TwilioSendError).twilioCode).toBe(21211);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after max retries (default 3) on persistent transient failures', async (): Promise<void> => {
    // A fresh Response per call — a body can only be read once.
    const fetchImpl = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockImplementation(() => Promise.resolve(twilioError(429)));

    const err = await sendWhatsApp(CREDS, CONTACT, 'hello', undefined, {
      sleep: noSleep,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e);

    expect((err as TwilioSendError).permanent).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it('backs off exponentially between retries', async (): Promise<void> => {
    const delays: number[] = [];
    const fetchImpl = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(twilioError(500))
      .mockResolvedValueOnce(twilioError(500))
      .mockResolvedValueOnce(twilioAccepted());

    await sendWhatsApp(CREDS, CONTACT, 'hello', undefined, {
      baseDelayMs: 500,
      sleep: ms => { delays.push(ms); return Promise.resolve(); },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(delays).toEqual([500, 1000]);
  });

  it('sends StatusCallback and prefers API-key auth when configured', async (): Promise<void> => {
    const fetchImpl = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockImplementation(() => Promise.resolve(twilioAccepted()));

    await sendWhatsApp(
      {
        ...CREDS,
        apiKeySid: 'SK999',
        apiKeySecret: 'secret',
        statusCallback: 'https://x.supabase.co/functions/v1/twilio-status',
      },
      CONTACT,
      'hello',
      undefined,
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get('StatusCallback')).toBe('https://x.supabase.co/functions/v1/twilio-status');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Basic ${btoa('SK999:secret')}`);
  });
});

describe('sendBatch permanent-failure handling', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('aborts the remainder of a batch on a permanent failure', async (): Promise<void> => {
    fetchMock.mockImplementation(() => Promise.resolve(twilioError(400, 63024)));

    const result = await sendBatch(CREDS, CONTACT, 'caption', [
      'https://cdn.test/a.jpg',
      'https://cdn.test/b.jpg',
      'https://cdn.test/c.jpg',
    ], 0);

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1); // aborted after the first permanent failure
    expect(result.permanentError?.twilioCode).toBe(63024);
  });

  it('collects sids of accepted messages', async (): Promise<void> => {
    fetchMock
      .mockResolvedValueOnce(twilioAccepted('SM1'))
      .mockResolvedValueOnce(twilioAccepted('SM2'));

    const result = await sendBatch(CREDS, CONTACT, 'caption', [
      'https://cdn.test/a.jpg',
      'https://cdn.test/b.jpg',
    ], 0);

    expect(result.sids).toEqual(['SM1', 'SM2']);
    expect(result.permanentError).toBeNull();
  });
});

describe('delivery-status classification (messageLog)', () => {
  it('treats failed/undelivered as terminal failures', () => {
    expect(isFailureStatus('failed')).toBe(true);
    expect(isFailureStatus('undelivered')).toBe(true);
    expect(isFailureStatus('delivered')).toBe(false);
    expect(isFailureStatus('sent')).toBe(false);
  });

  it('flags unreachable-recipient codes only', () => {
    expect(isUnreachableErrorCode(21211)).toBe(true); // invalid number
    expect(isUnreachableErrorCode(63024)).toBe(true); // invalid recipient
    expect(isUnreachableErrorCode(63016)).toBe(false); // outside 24h window — number is fine
    expect(isUnreachableErrorCode(null)).toBe(false);
  });
});
