import { assertEquals } from '@std/assert';
import { monthStart, plansEnforced, remainingMessages } from './messageBudget.ts';

const NOW = new Date('2026-11-16T12:00:00Z');

/** Fake supabase: `subscriptions` returns `sub`, `message_logs` count returns `sent`. */
// deno-lint-ignore no-explicit-any
function fake(sub: any, sent: number | null): any {
  return {
    from(table: string) {
      if (table === 'subscriptions') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: sub, error: null }) }) }) };
      }
      const chain = {
        eq: () => chain,
        gte: () => chain,
        not: () => Promise.resolve(sent == null ? { count: null, error: { message: 'boom' } } : { count: sent, error: null }),
      };
      return { select: () => chain };
    },
  };
}
const PLUS = { entitlement: 'plus', expires_at: '2026-12-01T00:00:00Z', grace_expires_at: null };

Deno.test('monthStart is the first of the UTC month', () => {
  assertEquals(monthStart(NOW), '2026-11-01T00:00:00.000Z');
});

Deno.test('plansEnforced only on the literal string true', () => {
  assertEquals(plansEnforced({ get: () => 'true' }), true);
  assertEquals(plansEnforced({ get: () => '1' }), false);
  assertEquals(plansEnforced({ get: () => undefined }), false);
});

Deno.test('remainingMessages: null (no budget) when enforcement is off', async () => {
  assertEquals(await remainingMessages(fake(null, 0), 'u', NOW, false), null);
});

Deno.test('remainingMessages: no subscription allows nothing', async () => {
  assertEquals(await remainingMessages(fake(null, 0), 'u', NOW, true), 0);
});

Deno.test('remainingMessages: plus gets the limit minus this month\'s sends', async () => {
  assertEquals(await remainingMessages(fake(PLUS, 500), 'u', NOW, true), 1500);
  assertEquals(await remainingMessages(fake(PLUS, 5000), 'u', NOW, true), 0);
});

Deno.test('remainingMessages: an unreadable counter does not silence a subscriber', async () => {
  assertEquals(await remainingMessages(fake(PLUS, null), 'u', NOW, true), null);
});
