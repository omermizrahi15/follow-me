import { assertStringIncludes } from '@std/assert';
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
