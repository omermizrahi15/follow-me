import { assertEquals } from '@std/assert';
import { normalizeWhatsApp, subscribeAction } from './logic.ts';

Deno.test('normalizeWhatsApp — accepts and prefixes a plain number with +', () => {
  assertEquals(normalizeWhatsApp('972501234567'), '+972501234567');
});

Deno.test('normalizeWhatsApp — keeps an existing + and strips spaces, dashes, parens', () => {
  assertEquals(normalizeWhatsApp(' +1 (415) 523-8886 '), '+14155238886');
});

Deno.test('normalizeWhatsApp — rejects implausible numbers', () => {
  assertEquals(normalizeWhatsApp(''), null);
  assertEquals(normalizeWhatsApp('123'), null); // too short
  assertEquals(normalizeWhatsApp('0123456789'), null); // leading zero
  assertEquals(normalizeWhatsApp('+1234567890123456'), null); // too long (>15 digits)
  assertEquals(normalizeWhatsApp('not-a-number'), null);
});

Deno.test('normalizeWhatsApp — boundary lengths (8 to 15 digits)', () => {
  assertEquals(normalizeWhatsApp('12345678'), '+12345678'); // 8 digits ok
  assertEquals(normalizeWhatsApp('123456789012345'), '+123456789012345'); // 15 digits ok
  assertEquals(normalizeWhatsApp('1234567'), null); // 7 digits too short
});

Deno.test('subscribeAction — no existing row means a fresh insert', () => {
  assertEquals(subscribeAction(null), 'insert');
});

Deno.test('subscribeAction — an already-active subscriber is not written or welcomed again', () => {
  assertEquals(subscribeAction({ status: 'active' }), 'already-active');
});

Deno.test('subscribeAction — a revoked/pending/unreachable subscriber is reactivated', () => {
  assertEquals(subscribeAction({ status: 'revoked' }), 'reactivate');
  assertEquals(subscribeAction({ status: 'pending' }), 'reactivate');
  assertEquals(subscribeAction({ status: 'unreachable' }), 'reactivate');
});
