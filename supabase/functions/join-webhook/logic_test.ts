import { assert, assertEquals } from '@std/assert';
import { contactHandleFromWhatsApp, formToParams, publisherDisplayName, twiml } from './logic.ts';

Deno.test('twiml — wraps the message in a text/xml TwiML Response', async () => {
  const res = twiml('Thanks!');
  assertEquals(res.headers.get('content-type'), 'text/xml');
  const body = await res.text();
  assert(body.includes('<Response><Message>Thanks!</Message></Response>'));
  assert(body.startsWith('<?xml'));
});

Deno.test('contactHandleFromWhatsApp — strips the whatsapp: scheme', () => {
  assertEquals(contactHandleFromWhatsApp('whatsapp:+15551234567'), '+15551234567');
  assertEquals(contactHandleFromWhatsApp('+15551234567'), '+15551234567'); // already bare
});

Deno.test('formToParams — keeps string fields, drops files', () => {
  const form = new FormData();
  form.append('From', 'whatsapp:+1');
  form.append('Body', 'STOP');
  form.append('media', new Blob(['x']), 'x.jpg');
  const p = formToParams(form);
  assertEquals(p, { From: 'whatsapp:+1', Body: 'STOP' });
});

Deno.test('publisherDisplayName — metadata name wins', () => {
  assertEquals(publisherDisplayName({ display_name: 'Uri Shiber' }, 'uri@example.com'), 'Uri Shiber');
});

Deno.test('publisherDisplayName — falls back to the email local-part, then a generic label', () => {
  assertEquals(publisherDisplayName({ display_name: '' }, 'uri@example.com'), 'uri');
  assertEquals(publisherDisplayName(null, 'uri@example.com'), 'uri');
  assertEquals(publisherDisplayName(null, null), 'your publisher');
  assertEquals(publisherDisplayName({}, undefined), 'your publisher');
});
