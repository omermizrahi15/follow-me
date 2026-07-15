import { assert, assertEquals } from '@std/assert';
import { contactHandleFromWhatsApp, twiml } from './logic.ts';

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
