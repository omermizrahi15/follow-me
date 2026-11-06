/**
 * Turns a RevenueCat webhook event into the `subscriptions` row it implies.
 *
 * Dual-runtime module (imports nothing — hence the entitlement id is repeated
 * from plans.ts and pinned by a test). Pure so the webhook's decisions — which
 * events grant, which only stop renewal, which are stale — are unit-tested
 * without a server. Returns null for "do nothing".
 */

export interface RevenueCatEvent {
  readonly type: string;
  readonly app_user_id?: string | null;
  readonly entitlement_ids?: readonly string[] | null;
  readonly event_timestamp_ms?: number | null;
  readonly expiration_at_ms?: number | null;
  readonly grace_period_expiration_at_ms?: number | null;
}

/** What is already stored for the user, if anything. */
export interface StoredSubscription {
  readonly graceExpiresAt: string | null;
  readonly expiresAt?: string | null;
  readonly lastEventMs: number;
}

export interface SubscriptionUpdate {
  readonly userId: string;
  readonly entitlement: 'plus';
  readonly expiresAt: string | null;
  readonly graceExpiresAt: string | null;
  readonly autoRenew: boolean;
  readonly lastEventMs: number;
}

const ENTITLEMENT = 'plus';
const GRANTING = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE']);
const HANDLED = new Set([...GRANTING, 'CANCELLATION', 'BILLING_ISSUE', 'EXPIRATION']);

function iso(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function applyRevenueCatEvent(
  event: RevenueCatEvent,
  stored: StoredSubscription | null,
): SubscriptionUpdate | null {
  if (!HANDLED.has(event.type)) return null;
  const userId = event.app_user_id;
  // Anonymous RevenueCat ids are not our users; a purchase we cannot attribute grants nothing.
  if (userId == null || userId === '' || userId.startsWith('$RCAnonymousID')) return null;
  if (!(event.entitlement_ids ?? []).includes(ENTITLEMENT)) return null;

  const eventMs = typeof event.event_timestamp_ms === 'number' ? event.event_timestamp_ms : 0;
  if (stored != null && eventMs < stored.lastEventMs) return null;

  const expiresAt = iso(event.expiration_at_ms);
  // An open-ended grant would be Plus forever; refuse it.
  if (expiresAt == null) return null;

  const common = { userId, entitlement: ENTITLEMENT, expiresAt, lastEventMs: eventMs } as const;
  switch (event.type) {
    case 'CANCELLATION':
      return { ...common, graceExpiresAt: stored?.graceExpiresAt ?? null, autoRenew: false };
    case 'BILLING_ISSUE':
      return { ...common, graceExpiresAt: iso(event.grace_period_expiration_at_ms), autoRenew: true };
    case 'EXPIRATION':
      return { ...common, graceExpiresAt: null, autoRenew: false };
    default:
      return { ...common, graceExpiresAt: null, autoRenew: event.type !== 'NON_RENEWING_PURCHASE' };
  }
}
