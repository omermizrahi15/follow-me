import { assertEquals } from '@std/assert';
import { followerSlotsLeft } from './followerBudget.ts';

const NOW = new Date('2026-11-16T12:00:00Z');
const PLUS = { entitlement: 'plus', expires_at: '2026-12-01T00:00:00Z', grace_expires_at: null };

// deno-lint-ignore no-explicit-any
function fake(sub: any, active: number | null): any {
  return {
    from(table: string) {
      if (table === 'subscriptions') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: sub, error: null }) }) }) };
      }
      const chain = {
        eq: () => chain,
        then: (resolve: (v: unknown) => void) =>
          resolve(active == null ? { count: null, error: { message: 'boom' } } : { count: active, error: null }),
      };
      return { select: () => chain };
    },
  };
}

Deno.test('followerSlotsLeft: null (no cap) when enforcement is off', async () => {
  assertEquals(await followerSlotsLeft(fake(null, 0), 'p', NOW, false), null);
});

Deno.test('followerSlotsLeft: a publisher without a subscription has no slots', async () => {
  assertEquals(await followerSlotsLeft(fake(null, 0), 'p', NOW, true), 0);
});

Deno.test('followerSlotsLeft: plus gets the limit minus active followers', async () => {
  assertEquals(await followerSlotsLeft(fake(PLUS, 10), 'p', NOW, true), 40);
  assertEquals(await followerSlotsLeft(fake(PLUS, 50), 'p', NOW, true), 0);
  assertEquals(await followerSlotsLeft(fake(PLUS, 80), 'p', NOW, true), 0);
});

Deno.test('followerSlotsLeft: an unreadable count does not turn followers away', async () => {
  assertEquals(await followerSlotsLeft(fake(PLUS, null), 'p', NOW, true), null);
});
