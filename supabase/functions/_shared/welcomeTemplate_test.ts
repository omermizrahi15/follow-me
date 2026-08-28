import { assertEquals } from '@std/assert';
import { buildWelcomeTemplate, type WelcomeTemplateEnv } from './welcomeTemplate.ts';

const env: WelcomeTemplateEnv = { welcomeSid: 'HX_welcome' };
const feed = 'https://omermizrahi15.github.io/follow-me/gallery.html?u=pub-1';
const input = { publisherName: 'Uri', galleryUrl: feed };

Deno.test('buildWelcomeTemplate — fills the name and feed-link variables', () => {
  assertEquals(buildWelcomeTemplate(env, input), {
    contentSid: 'HX_welcome',
    variables: { '1': 'Uri', '2': feed },
  });
});

Deno.test('buildWelcomeTemplate — collapses whitespace WhatsApp rejects in a variable', () => {
  const send = buildWelcomeTemplate(env, { ...input, publisherName: '  Uri\n Shiber  ' });
  assertEquals(send?.variables['1'], 'Uri Shiber');
});

Deno.test('buildWelcomeTemplate — null when the SID is not configured', () => {
  assertEquals(buildWelcomeTemplate({}, input), null);
});

Deno.test('buildWelcomeTemplate — null when the name is blank, so the caller sends free-form', () => {
  assertEquals(buildWelcomeTemplate(env, { ...input, publisherName: '   ' }), null);
});

Deno.test('buildWelcomeTemplate — null when the feed link is missing, so no slot is left empty', () => {
  assertEquals(buildWelcomeTemplate(env, { ...input, galleryUrl: '' }), null);
});
