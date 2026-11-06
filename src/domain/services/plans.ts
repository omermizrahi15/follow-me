/**
 * Subscription plans and what each one allows.
 *
 * Dual-runtime module (app + Deno Edge Functions): it imports nothing. Every
 * cost-driving limit lives in {@link PLANS} so the numbers are tuned in ONE
 * place (issue #252) rather than scattered across functions. The server is the
 * source of truth — the app only displays these.
 */
export type PlanId = 'free' | 'plus';

export interface PlanLimits {
  /** Photos sent to the AI grader per day. */
  readonly aiPhotosPerDay: number;
  /** WhatsApp post messages sent per calendar month. */
  readonly whatsappPostsPerMonth: number;
  /** Active followers a publisher may have. */
  readonly followers: number;
}

export const PLANS: Readonly<Record<PlanId, PlanLimits>> = {
  free: { aiPhotosPerDay: 50, whatsappPostsPerMonth: 10, followers: 5 },
  plus: { aiPhotosPerDay: 500, whatsappPostsPerMonth: 100, followers: 50 },
};

/** The entitlement id configured in RevenueCat that unlocks {@link PlanId} `plus`. */
export const PLUS_ENTITLEMENT = 'plus';

export function limitsFor(plan: PlanId): PlanLimits {
  return PLANS[plan];
}

/** A row of the `subscriptions` table, as the plan decision needs it. */
export interface SubscriptionFacts {
  readonly entitlement: string | null;
  /** End of the paid period, ISO string. */
  readonly expiresAt: string | null;
  /** End of the store's billing-retry grace window, ISO string. */
  readonly graceExpiresAt: string | null;
}

function laterThan(iso: string | null, now: Date): boolean {
  if (iso == null) return false;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms > now.getTime();
}

/**
 * Which plan a user is on right now.
 *
 * Fails CLOSED: anything unknown, missing or unparseable is Free. Cancelling
 * only stops renewal, so a cancelled subscription stays Plus until its paid
 * period ends; a billing problem keeps Plus through the store's grace window.
 */
export function planFromSubscription(sub: SubscriptionFacts | null, now: Date): PlanId {
  if (sub == null || sub.entitlement !== PLUS_ENTITLEMENT) return 'free';
  return laterThan(sub.expiresAt, now) || laterThan(sub.graceExpiresAt, now) ? 'plus' : 'free';
}
