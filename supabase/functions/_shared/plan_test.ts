import { assertEquals } from '@std/assert';
import { loadPlan, type PlanDb } from './plan.ts';

type Row = { entitlement: string | null; expires_at: string | null; grace_expires_at: string | null };

function db(result: { data: Row | null; error: { message: string } | null }): PlanDb {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(result) }) }) }),
  };
}

const NOW = new Date('2026-11-06T12:00:00Z');

Deno.test('loadPlan: no row is none', async () => {
  assertEquals(await loadPlan(db({ data: null, error: null }), 'u', NOW), 'none');
});

Deno.test('loadPlan: a live plus row is plus', async () => {
  const data = { entitlement: 'plus', expires_at: '2026-12-01T00:00:00Z', grace_expires_at: null };
  assertEquals(await loadPlan(db({ data, error: null }), 'u', NOW), 'plus');
});

Deno.test('loadPlan: an expired row is none', async () => {
  const data = { entitlement: 'plus', expires_at: '2026-10-01T00:00:00Z', grace_expires_at: null };
  assertEquals(await loadPlan(db({ data, error: null }), 'u', NOW), 'none');
});

Deno.test('loadPlan: a failed read fails closed to none', async () => {
  assertEquals(await loadPlan(db({ data: null, error: { message: 'boom' } }), 'u', NOW), 'none');
});
