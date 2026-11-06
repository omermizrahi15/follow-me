import {
  planFromSubscription,
  type PlanId,
} from '../../../src/domain/services/plans.ts';

/** The slice of supabase-js `loadPlan` needs, so tests can inject a fake. */
export interface PlanDb {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{
          data: { entitlement: string | null; expires_at: string | null; grace_expires_at: string | null } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

/**
 * The plan a user is on right now. Fails CLOSED to none (no access): a failed read must
 * never be able to grant Plus (and so never spend anything).
 */
export async function loadPlan(db: PlanDb, userId: string, now: Date = new Date()): Promise<PlanId> {
  const { data, error } = await db
    .from('subscriptions')
    .select('entitlement, expires_at, grace_expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error != null) {
    console.error('plan lookup failed, treating as free:', error.message);
    return 'none';
  }
  if (data == null) return 'none';
  return planFromSubscription(
    { entitlement: data.entitlement, expiresAt: data.expires_at, graceExpiresAt: data.grace_expires_at },
    now,
  );
}
