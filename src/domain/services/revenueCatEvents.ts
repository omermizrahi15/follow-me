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
  readonly id?: string | null;
  readonly product_id?: string | null;
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
/** App Store product id and size of the one-time history-backfill pack (mirrors plans.ts). */
const BACKFILL_PACK_PRODUCT_ID = 'follow_me_backfill_pack';
const BACKFILL_PACK_PHOTOS = 3000;
// A one-time purchase is NOT a subscription: it must never grant Plus.
const GRANTING = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION']);
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
      return { ...common, graceExpiresAt: null, autoRenew: true };
  }
}

export interface CreditGrant {
  readonly userId: string;
  /** RevenueCat's event id: the idempotency key, so a redelivered event grants once. */
  readonly eventId: string;
  readonly photos: number;
}

/** AI credits a backfill-pack purchase grants, or null when the event is not one. */
export function creditGrantFromEvent(event: RevenueCatEvent): CreditGrant | null {
  if (event.type !== 'NON_RENEWING_PURCHASE' || event.product_id !== BACKFILL_PACK_PRODUCT_ID) return null;
  const userId = event.app_user_id;
  if (userId == null || userId === '' || userId.startsWith('$RCAnonymousID')) return null;
  if (event.id == null || event.id === '') return null;
  return { userId, eventId: event.id, photos: BACKFILL_PACK_PHOTOS };
}
