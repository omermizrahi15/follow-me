import { assertEquals } from '@std/assert';
import { isAuthorized } from './logic.ts';

Deno.test('isAuthorized accepts only the exact bearer secret', () => {
  assertEquals(isAuthorized('Bearer s3cret', 's3cret'), true);
  assertEquals(isAuthorized('Bearer wrong!', 's3cret'), false);
  assertEquals(isAuthorized('s3cret', 's3cret'), false);
  assertEquals(isAuthorized(null, 's3cret'), false);
});

Deno.test('isAuthorized rejects everything when no secret is configured', () => {
  assertEquals(isAuthorized('Bearer ', ''), false);
  assertEquals(isAuthorized('', ''), false);
});
