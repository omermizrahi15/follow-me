import { assertEquals } from '@std/assert';
import { buildPostTemplate, type PostTemplateEnv, type PostTemplateInput } from './postTemplate.ts';

const env: PostTemplateEnv = { postSid: 'HX_post', postLocationSid: 'HX_loc' };
const base: PostTemplateInput = {
  publisherName: 'Uri',
  publisherPhone: '+14155238886',
  photoCount: 3,
  galleryUrl: 'https://gallery/abc',
  mediaUrl: 'https://media/collage.jpg',
  place: null,
};

Deno.test('buildPostTemplate — null when gallery, media, or phone is missing', () => {
  assertEquals(buildPostTemplate(env, { ...base, galleryUrl: null }), null);
  assertEquals(buildPostTemplate(env, { ...base, mediaUrl: null }), null);
  assertEquals(buildPostTemplate(env, { ...base, publisherPhone: undefined }), null);
});

Deno.test('buildPostTemplate — no place uses the post template with the 6-variable order', () => {
  const send = buildPostTemplate(env, base);
  assertEquals(send?.contentSid, 'HX_post');
  assertEquals(send?.variables, {
    '1': 'Uri',
    '2': '3',
    '3': 'https://gallery/abc',
    '4': 'Uri',
    '5': 'https://wa.me/14155238886', // reply link strips the leading +
    '6': 'https://media/collage.jpg',
  });
});

Deno.test('buildPostTemplate — with place uses the location template and 7-variable order', () => {
  const send = buildPostTemplate(env, { ...base, place: 'Lisbon, Portugal' });
  assertEquals(send?.contentSid, 'HX_loc');
  assertEquals(send?.variables, {
    '1': 'Uri',
    '2': 'Lisbon, Portugal',
    '3': '3',
    '4': 'https://gallery/abc',
    '5': 'Uri',
    '6': 'https://wa.me/14155238886',
    '7': 'https://media/collage.jpg',
  });
});

Deno.test('buildPostTemplate — falls back to the no-location template when postLocationSid is unset', () => {
  const send = buildPostTemplate({ postSid: 'HX_post' }, { ...base, place: 'Lisbon' });
  assertEquals(send?.contentSid, 'HX_post');
  assertEquals(Object.keys(send?.variables ?? {}).length, 6);
});

Deno.test('buildPostTemplate — null when no usable SID is configured', () => {
  assertEquals(buildPostTemplate({}, base), null);
});

Deno.test('buildPostTemplate — blank/whitespace place is treated as no place', () => {
  const send = buildPostTemplate(env, { ...base, place: '   ' });
  assertEquals(send?.contentSid, 'HX_post');
});

Deno.test('buildPostTemplate — collapses whitespace/newlines in name and place (WhatsApp rejects them)', () => {
  const send = buildPostTemplate(env, { ...base, publisherName: 'Uri   \n Shiber', place: 'Porto\t\tCity' });
  assertEquals(send?.variables['1'], 'Uri Shiber');
  assertEquals(send?.variables['2'], 'Porto City');
});
