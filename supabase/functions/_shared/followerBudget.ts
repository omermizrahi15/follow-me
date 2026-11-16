import { limitsFor } from '../../../src/domain/services/plans.ts';
import { plansEnforced } from './messageBudget.ts';
import { loadPlan, type PlanDb } from './plan.ts';

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

/**
 * How many more followers the publisher's plan lets them have, or null when no
 * cap applies (enforcement off, issue #252).
 *
 * Counts ACTIVE followers: a revoked or unreachable one costs nothing, so
 * leaving does free a slot. The plan lookup fails closed (no subscription → no
 * slots); an unreadable COUNT fails open, so a flaky read never turns away a
 * follower of a paying publisher.
 */
export async function followerSlotsLeft(
  supabase: SupabaseClient,
  publisherId: string,
  now: Date = new Date(),
  enforced: boolean = plansEnforced(),
): Promise<number | null> {
  if (!enforced) return null;
  const plan = await loadPlan(supabase as PlanDb, publisherId, now);
  const limit = limitsFor(plan).followers;
  if (limit === 0) return 0;
  const { count, error } = await supabase
    .from('subscribers')
    .select('id', { count: 'exact', head: true })
    .eq('publisher_id', publisherId)
    .eq('status', 'active');
  if (error != null) {
    console.error('follower count failed, not limiting:', error.message);
    return null;
  }
  return Math.max(0, limit - (count ?? 0));
}
