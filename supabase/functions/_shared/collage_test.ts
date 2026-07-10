import { assert, assertEquals } from '@std/assert';
import { collageUrl } from './collage.ts';

const P = 'https://res.cloudinary.com/mycloud/image/upload';

Deno.test('collageUrl — null for fewer than two photos', () => {
  assertEquals(collageUrl([]), null);
  assertEquals(collageUrl([`${P}/v1/a.jpg`]), null);
});

Deno.test('collageUrl — null when any URL is not a Cloudinary upload URL', () => {
  assertEquals(collageUrl([`${P}/v1/a.jpg`, 'https://example.com/b.jpg']), null);
});

Deno.test('collageUrl — null when photos span different Cloudinary accounts', () => {
  const other = 'https://res.cloudinary.com/othercloud/image/upload';
  assertEquals(collageUrl([`${P}/v1/a.jpg`, `${other}/v1/b.jpg`]), null);
});

Deno.test('collageUrl — two photos build a 2×1 grid ending in a JPEG public id', () => {
  const url = collageUrl([`${P}/v1/a.jpg`, `${P}/v1/b.jpg`]);
  assert(url !== null);
  const u = url as string;
  assert(u.startsWith(P), 'keeps the shared prefix');
  assert(u.includes('c_fill,w_500,h_500'), 'first cell fill');
  assert(u.includes('b_rgb:1a1a1a,c_pad,g_north_west,w_1000,h_500'), 'padded to full 2×1 canvas');
  assert(u.includes('fl_layer_apply,g_north_west,x_500,y_0'), 'second photo pinned to cell (1,0)');
  assert(u.includes('f_jpg,q_auto:good'), 'JPEG output');
  assert(u.endsWith('/v1/a.jpg'), 'base layer is the first photo');
});

Deno.test('collageUrl — folder public ids use ":" as the layer separator', () => {
  const url = collageUrl([`${P}/v1/trip/a.jpg`, `${P}/v1/trip/b.jpg`]) as string;
  assert(url.includes('l_trip:b'), 'layer id escapes "/" to ":"');
});

Deno.test('collageUrl — four photos form a 2×2 grid with correct cell offsets', () => {
  const url = collageUrl([`${P}/v1/a.jpg`, `${P}/v1/b.jpg`, `${P}/v1/c.jpg`, `${P}/v1/d.jpg`]) as string;
  assert(url.includes('w_1000,h_1000'), '2×2 canvas at 500px cells');
  assert(url.includes('x_500,y_0'), 'top-right cell');
  assert(url.includes('x_0,y_500'), 'bottom-left cell');
  assert(url.includes('x_500,y_500'), 'bottom-right cell');
});
