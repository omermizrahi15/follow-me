import { assertEquals } from '@std/assert';
import { buildWelcomeTemplate, type WelcomeTemplateEnv } from './welcomeTemplate.ts';

const env: WelcomeTemplateEnv = { welcomeSid: 'HX_welcome' };

Deno.test('buildWelcomeTemplate — fills the single name variable', () => {
  assertEquals(buildWelcomeTemplate(env, { publisherName: 'Uri' }), {
    contentSid: 'HX_welcome',
    variables: { '1': 'Uri' },
  });
});

Deno.test('buildWelcomeTemplate — collapses whitespace WhatsApp rejects in a variable', () => {
  const send = buildWelcomeTemplate(env, { publisherName: '  Uri\n Shiber  ' });
  assertEquals(send?.variables, { '1': 'Uri Shiber' });
});

Deno.test('buildWelcomeTemplate — null when the SID is not configured', () => {
  assertEquals(buildWelcomeTemplate({}, { publisherName: 'Uri' }), null);
});

Deno.test('buildWelcomeTemplate — null when the name is blank, so the caller sends free-form', () => {
  assertEquals(buildWelcomeTemplate(env, { publisherName: '   ' }), null);
});
