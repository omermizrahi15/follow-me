import { assert, assertEquals, assertRejects } from '@std/assert';
import {
  credsFromEnv,
  isTransientStatus,
  sendBatch,
  sendWhatsApp,
  sendWhatsAppTemplate,
  type TwilioCreds,
  TwilioSendError,
  whatsappSafeMediaUrl,
} from '../../../src/infrastructure/notifiers/twilioClient.ts';

const creds: TwilioCreds = { accountSid: 'AC1', authToken: 'tok', fromNumber: '+14155238886' };
const noSleep = (_ms: number): Promise<void> => Promise.resolve();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A fetch stub that dispenses queued responses (an Error entry rejects, mimicking a network blip). */
function mockFetch(queue: Array<Response | Error>): { fn: typeof fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = ((url: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? jsonResponse(201, { sid: 'SM_default' }));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

// ── pure helpers ───────────────────────────────────────────────────────────

Deno.test('isTransientStatus — 429 and 5xx are transient, other statuses are not', () => {
  assert(isTransientStatus(429));
  assert(isTransientStatus(500));
  assert(isTransientStatus(503));
  assert(!isTransientStatus(400));
  assert(!isTransientStatus(404));
  assert(!isTransientStatus(200));
});

Deno.test('whatsappSafeMediaUrl — injects a JPEG transform into a raw Cloudinary upload URL', () => {
  assertEquals(
    whatsappSafeMediaUrl('https://res.cloudinary.com/demo/image/upload/v123/photo.heic'),
    'https://res.cloudinary.com/demo/image/upload/f_jpg,q_auto:good,w_1600/v123/photo.heic',
  );
});

Deno.test('whatsappSafeMediaUrl — leaves already-transformed and non-Cloudinary URLs untouched', () => {
  const already = 'https://res.cloudinary.com/demo/image/upload/f_jpg/v1/x.jpg';
  assertEquals(whatsappSafeMediaUrl(already), already);
  assertEquals(whatsappSafeMediaUrl('https://example.com/pic.jpg'), 'https://example.com/pic.jpg');
});

// ── sendWhatsApp: success, retries, classification, backoff, auth ───────────

Deno.test('sendWhatsApp — returns the SID and posts To/From/Body', async () => {
  const { fn, calls } = mockFetch([jsonResponse(201, { sid: 'SM123' })]);
  const res = await sendWhatsApp(creds, '+15550001111', 'hello', 'https://media/x.jpg', { fetchImpl: fn, sleep: noSleep });
  assertEquals(res.sid, 'SM123');
  assertEquals(calls.length, 1);
  const body = String(calls[0].init.body);
  assert(body.includes('To=whatsapp'));
  assert(body.includes('Body=hello'));
  assert(body.includes('MediaUrl='));
});

Deno.test('sendWhatsApp — retries a transient 429 then succeeds', async () => {
  const { fn, calls } = mockFetch([jsonResponse(429, { code: 20429 }), jsonResponse(201, { sid: 'SM9' })]);
  const res = await sendWhatsApp(creds, '+1555', 'hi', undefined, { fetchImpl: fn, sleep: noSleep });
  assertEquals(res.sid, 'SM9');
  assertEquals(calls.length, 2);
});

Deno.test('sendWhatsApp — retries a network error (no HTTP response)', async () => {
  const { fn } = mockFetch([new Error('boom'), jsonResponse(201, { sid: 'SM1' })]);
  const res = await sendWhatsApp(creds, '+1', 'x', undefined, { fetchImpl: fn, sleep: noSleep });
  assertEquals(res.sid, 'SM1');
});

Deno.test('sendWhatsApp — a permanent 4xx throws immediately, exposing status + Twilio code', async () => {
  const { fn, calls } = mockFetch([jsonResponse(400, { code: 21211, message: 'invalid To' })]);
  const err = await assertRejects(
    () => sendWhatsApp(creds, '+1', 'x', undefined, { fetchImpl: fn, sleep: noSleep }),
    TwilioSendError,
  );
  assertEquals(err.permanent, true);
  assertEquals(err.status, 400);
  assertEquals(err.twilioCode, 21211);
  assertEquals(calls.length, 1);
});

Deno.test('sendWhatsApp — gives up after maxRetries on persistent transient failures', async () => {
  const { fn, calls } = mockFetch([jsonResponse(503, {}), jsonResponse(503, {}), jsonResponse(503, {})]);
  await assertRejects(() => sendWhatsApp(creds, '+1', 'x', undefined, { fetchImpl: fn, sleep: noSleep, maxRetries: 2 }));
  assertEquals(calls.length, 3); // initial attempt + 2 retries
});

Deno.test('sendWhatsApp — backs off base * 2^(n-1) between retries', async () => {
  const delays: number[] = [];
  const { fn } = mockFetch([jsonResponse(500, {}), jsonResponse(500, {}), jsonResponse(201, { sid: 'SM' })]);
  await sendWhatsApp(creds, '+1', 'x', undefined, {
    fetchImpl: fn,
    baseDelayMs: 100,
    sleep: (ms: number): Promise<void> => { delays.push(ms); return Promise.resolve(); },
  });
  assertEquals(delays, [100, 200]);
});

Deno.test('sendWhatsApp — adds StatusCallback and prefers API-key basic auth when configured', async () => {
  const { fn, calls } = mockFetch([jsonResponse(201, { sid: 'SM' })]);
  const c: TwilioCreds = { ...creds, apiKeySid: 'SK1', apiKeySecret: 'secret', statusCallback: 'https://cb' };
  await sendWhatsApp(c, '+1', 'x', undefined, { fetchImpl: fn, sleep: noSleep });
  assert(String(calls[0].init.body).includes('StatusCallback='));
  const auth = (calls[0].init.headers as Record<string, string>).Authorization;
  assertEquals(auth, 'Basic ' + btoa('SK1:secret'));
});

Deno.test('sendWhatsAppTemplate — posts ContentSid and ContentVariables', async () => {
  const { fn, calls } = mockFetch([jsonResponse(201, { sid: 'SM' })]);
  await sendWhatsAppTemplate(creds, '+1', 'HX123', { '1': 'a', '2': 'b' }, { fetchImpl: fn, sleep: noSleep });
  const body = String(calls[0].init.body);
  assert(body.includes('ContentSid=HX123'));
  assert(body.includes('ContentVariables='));
});

// ── sendBatch (uses the global fetch — stub it) ─────────────────────────────

const CLD = 'https://res.cloudinary.com/d/image/upload';

Deno.test('sendBatch — caption on the first message only, transformed media, collects SIDs', async () => {
  const orig = globalThis.fetch;
  const { fn, calls } = mockFetch([jsonResponse(201, { sid: 'SM1' }), jsonResponse(201, { sid: 'SM2' })]);
  globalThis.fetch = fn;
  try {
    const res = await sendBatch(creds, '+1', 'caption', [`${CLD}/v1/a.heic`, `${CLD}/v1/b.heic`], 0);
    assertEquals(res.sent, 2);
    assertEquals(res.failed, 0);
    assertEquals(res.sids, ['SM1', 'SM2']);
    assert(String(calls[0].init.body).includes('Body=caption'));
    assert(!String(calls[1].init.body).includes('caption'));
    assert(String(calls[0].init.body).includes('f_jpg')); // whatsappSafeMediaUrl applied
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test('sendBatch — a permanent failure aborts the remainder of the batch', async () => {
  const orig = globalThis.fetch;
  const { fn, calls } = mockFetch([jsonResponse(400, { code: 21610, message: 'opted out' })]);
  globalThis.fetch = fn;
  try {
    const res = await sendBatch(creds, '+1', 'cap', [`${CLD}/v1/a.jpg`, `${CLD}/v1/b.jpg`, `${CLD}/v1/c.jpg`], 0);
    assertEquals(res.sent, 0);
    assert(res.permanentError !== null);
    assertEquals(calls.length, 1);
  } finally {
    globalThis.fetch = orig;
  }
});

// ── credsFromEnv ────────────────────────────────────────────────────────────

Deno.test('credsFromEnv — maps required vars; includes optionals only when present', () => {
  const base = new Map([
    ['TWILIO_ACCOUNT_SID', 'AC'],
    ['TWILIO_AUTH_TOKEN', 'tok'],
    ['TWILIO_WHATSAPP_FROM', '+1'],
  ]);
  const c1 = credsFromEnv({ get: (k: string) => base.get(k) });
  assertEquals(c1.accountSid, 'AC');
  assertEquals(c1.authToken, 'tok');
  assertEquals(c1.apiKeySid, undefined);
  assertEquals(c1.statusCallback, undefined);

  const full = new Map(base);
  full.set('TWILIO_API_KEY_SID', 'SK');
  full.set('TWILIO_API_KEY_SECRET', 'sek');
  full.set('TWILIO_STATUS_CALLBACK_URL', 'https://cb');
  full.set('TWILIO_TEMPLATE_POST_SID', 'HXp');
  full.set('TWILIO_TEMPLATE_POST_LOCATION_SID', 'HXl');
  const c2 = credsFromEnv({ get: (k: string) => full.get(k) });
  assertEquals(c2.apiKeySid, 'SK');
  assertEquals(c2.apiKeySecret, 'sek');
  assertEquals(c2.statusCallback, 'https://cb');
  assertEquals(c2.templatePostSid, 'HXp');
  assertEquals(c2.templatePostLocationSid, 'HXl');
});
