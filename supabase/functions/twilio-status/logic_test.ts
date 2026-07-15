import { assert, assertEquals } from '@std/assert';
import { parseErrorCode, shouldMarkUnreachable } from './logic.ts';

Deno.test('parseErrorCode — numeric string, empty, and non-numeric', () => {
  assertEquals(parseErrorCode('21211'), 21211);
  assertEquals(parseErrorCode(''), null);
  assertEquals(parseErrorCode('not-a-number'), null);
});

Deno.test('shouldMarkUnreachable — failure status AND an unreachable code', () => {
  assert(shouldMarkUnreachable('failed', '21211')); // invalid number
  assert(shouldMarkUnreachable('undelivered', '63003')); // channel can't reach
});

Deno.test('shouldMarkUnreachable — false for progress states or non-recipient codes', () => {
  assert(!shouldMarkUnreachable('delivered', '21211')); // not a failure state
  assert(!shouldMarkUnreachable('failed', '63016')); // outside 24h window — not the number
  assert(!shouldMarkUnreachable('failed', '')); // no code
});
