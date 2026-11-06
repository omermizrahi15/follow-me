import { limitsFor } from '../../../src/domain/services/plans.ts';
import { loadPlan, type PlanDb } from './plan.ts';

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

/** Per-plan limits ship dark: nothing is capped until this is `true` (issue #252). */
export function plansEnforced(env: { get(k: string): string | undefined } = Deno.env): boolean {
  return env.get('ENFORCE_PLAN_LIMITS') === 'true';
}

/** First instant of the current UTC month — what "per month" means for the cap. */
export function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * WhatsApp messages the publisher may still send this month, or null when no
 * budget applies (enforcement off).
 *
 * The plan lookup fails closed (no subscription → nothing allowed). The COUNT
 * fails open: a counter that cannot be read must not silence a paying user's
 * posts, and the same asymmetry already holds for the AI counter.
 */
export async function remainingMessages(
  supabase: SupabaseClient,
  publisherId: string,
  now: Date = new Date(),
  enforced: boolean = plansEnforced(),
): Promise<number | null> {
  if (!enforced) return null;
  const plan = await loadPlan(supabase as PlanDb, publisherId, now);
  const limit = limitsFor(plan).whatsappMessagesPerMonth;
  if (limit === 0) return 0;
  const { count, error } = await supabase
    .from('message_logs')
    .select('id', { count: 'exact', head: true })
    .eq('publisher_id', publisherId)
    .gte('created_at', monthStart(now))
    // Synthetic keys for sends Twilio rejected outright: never billed, never counted.
    .not('message_sid', 'like', 'rejected-%');
  if (error != null) {
    console.error('message budget count failed, not limiting:', error.message);
    return null;
  }
  return Math.max(0, limit - (count ?? 0));
}
