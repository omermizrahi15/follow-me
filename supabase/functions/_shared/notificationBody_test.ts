import { assertStringIncludes } from '@std/assert';
import { composeAutoPostBody } from './notificationBody.ts';

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

Deno.test('includes the song line when the post has one (issue #54)', () => {
  const body = composeAutoPostBody('Uri', undefined, null, null, { title: 'Vienna', artist: 'Billy Joel' });
  assertStringIncludes(body, '🎵 Vienna — Billy Joel');
});
