import { assertEquals, assertStringIncludes } from '@std/assert';
import { composeAutoPostBody } from '../../../src/domain/services/notificationBody.ts';

Deno.test('headline without a place', () => {
  assertStringIncludes(composeAutoPostBody('Uri'), "Check out Uri's latest photos");
});

Deno.test('headline names the place when given', () => {
  assertStringIncludes(composeAutoPostBody('Uri', undefined, null, 'Lisbon'), 'from Lisbon');
});

Deno.test('includes the gallery link and photo count', () => {
  const body = composeAutoPostBody('Uri', undefined, { url: 'https://g/1', photoCount: 5 });
  assertStringIncludes(body, 'See all 5 photos: https://g/1');
});

Deno.test('includes a wa.me reply link with the + stripped', () => {
  assertStringIncludes(composeAutoPostBody('Uri', '+15551234567'), 'https://wa.me/15551234567');
});

// Issue #143 — the link pre-fills the subject, since WhatsApp offers no way to
// open a quoted reply to the post message itself.
Deno.test('reply link pre-fills the place the post came from', () => {
  const body = composeAutoPostBody('Uri', '+15551234567', null, 'Lisbon');
  assertStringIncludes(decodeURIComponent(body), 'Re: your photos from Lisbon ✨');
});

Deno.test('reply link falls back to "your latest photos" for a place-less post', () => {
  const body = composeAutoPostBody('Uri', '+15551234567');
  assertStringIncludes(decodeURIComponent(body), 'Re: your latest photos ✨');
});

// Issue #220 — the publisher's optional caption sits right under the headline,
// ahead of the gallery link, and a post without one reads exactly as before.
Deno.test('caption is its own paragraph between the headline and the gallery link', () => {
  const body = composeAutoPostBody('Uri', undefined, { url: 'https://g/1', photoCount: 5 }, 'Lisbon', 'Pastel de nata 🥐');
  assertEquals(body.split('\n\n'), [
    "Check out Uri's latest photos from Lisbon 📸",
    'Pastel de nata 🥐',
    'See all 5 photos: https://g/1',
  ]);
});

Deno.test('a blank or missing caption changes nothing', () => {
  const plain = composeAutoPostBody('Uri', '+15551234567', { url: 'https://g/1', photoCount: 2 }, 'Lisbon');
  assertEquals(composeAutoPostBody('Uri', '+15551234567', { url: 'https://g/1', photoCount: 2 }, 'Lisbon', null), plain);
  assertEquals(composeAutoPostBody('Uri', '+15551234567', { url: 'https://g/1', photoCount: 2 }, 'Lisbon', '  \n '), plain);
});

Deno.test('caption keeps its own line breaks in the free-form body', () => {
  const body = composeAutoPostBody('Uri', undefined, null, null, 'Day one\nDay two');
  assertStringIncludes(body, 'Day one\nDay two');
});
