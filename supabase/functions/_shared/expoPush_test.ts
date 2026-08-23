import { assertEquals } from '@std/assert';
import { isTokenDead, sendExpoPush, ticketFailure } from './expoPush.ts';

Deno.test('ticketFailure — an accepted push reports no failure', () => {
  assertEquals(ticketFailure({ data: { status: 'ok', id: 'XXXX-YYYY' } }), null);
});

Deno.test('ticketFailure — reads a per-message error out of an HTTP 200', () => {
  // The shape that made this whole class of bug invisible: transport says 200,
  // the ticket says the notification went nowhere.
  assertEquals(
    ticketFailure({
      data: {
        status: 'error',
        message: '"ExponentPushToken[x]" is not a registered push notification recipient',
        details: { error: 'DeviceNotRegistered' },
      },
    }),
    {
      code: 'DeviceNotRegistered',
      message: '"ExponentPushToken[x]" is not a registered push notification recipient',
    },
  );
});

Deno.test('ticketFailure — handles the array form and returns the first failure', () => {
  assertEquals(
    ticketFailure({
      data: [
        { status: 'ok' },
        { status: 'error', message: 'boom', details: { error: 'MessageTooBig' } },
      ],
    }),
    { code: 'MessageTooBig', message: 'boom' },
  );
});

Deno.test('ticketFailure — reads request-level rejections', () => {
  assertEquals(
    ticketFailure({ errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'mixed ids' }] }),
    { code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'mixed ids' },
  );
});

Deno.test('ticketFailure — an error with no details still reports, uncoded', () => {
  assertEquals(ticketFailure({ data: { status: 'error', message: 'nope' } }), {
    code: null,
    message: 'nope',
  });
});

Deno.test('ticketFailure — an unrecognised body is not a failure', () => {
  // Inventing failures from a changed envelope would clear live push tokens.
  assertEquals(ticketFailure({}), null);
  assertEquals(ticketFailure(null), null);
  assertEquals(ticketFailure('surprise'), null);
  assertEquals(ticketFailure({ data: { status: 'ok' } }), null);
});

Deno.test('isTokenDead — only DeviceNotRegistered is permanent', () => {
  assertEquals(isTokenDead({ code: 'DeviceNotRegistered', message: '' }), true);
  // Transient: worth retrying next tick, must NOT clear the token.
  assertEquals(isTokenDead({ code: 'MessageRateExceeded', message: '' }), false);
  assertEquals(isTokenDead({ code: null, message: 'timeout' }), false);
  assertEquals(isTokenDead(null), false);
});

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

Deno.test('sendExpoPush — posts the message and passes a good ticket through', async () => {
  let seen: { url: string; body: unknown } | null = null;
  const failure = await sendExpoPush({ to: 'ExponentPushToken[x]', title: 'hi' }, (url, init) => {
    seen = { url: String(url), body: JSON.parse(String(init?.body)) };
    return Promise.resolve(okResponse({ data: { status: 'ok' } }));
  });

  assertEquals(failure, null);
  assertEquals(seen!.url, 'https://exp.host/--/api/v2/push/send');
  assertEquals(seen!.body, { to: 'ExponentPushToken[x]', title: 'hi' });
});

Deno.test('sendExpoPush — surfaces a ticket error from a 200', async () => {
  const failure = await sendExpoPush({ to: 'dead' }, () =>
    Promise.resolve(
      okResponse({ data: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } }),
    ));
  assertEquals(failure, { code: 'DeviceNotRegistered', message: 'gone' });
});

Deno.test('sendExpoPush — a non-2xx is reported with its status', async () => {
  const failure = await sendExpoPush({ to: 'x' }, () =>
    Promise.resolve(new Response('nope', { status: 503 })));
  assertEquals(failure, { code: null, message: 'Expo push returned HTTP 503' });
});

Deno.test('sendExpoPush — a transport error is returned, never thrown', async () => {
  // A push is not the posting. Reaching Expo failing must not unwind the run
  // that already built and saved the batch.
  const failure = await sendExpoPush({ to: 'x' }, () => Promise.reject(new Error('dns')));
  assertEquals(failure?.code, null);
  assertEquals(failure!.message.includes('dns'), true);
});

Deno.test('sendExpoPush — an unparseable 200 body counts as accepted', async () => {
  const failure = await sendExpoPush({ to: 'x' }, () =>
    Promise.resolve(new Response('<html>', { status: 200 })));
  assertEquals(failure, null);
});
