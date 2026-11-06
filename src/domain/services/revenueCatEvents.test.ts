import { applyRevenueCatEvent, type StoredSubscription } from './revenueCatEvents';

const T = (iso: string): number => Date.parse(iso);
const base = {
  app_user_id: 'user-1',
  entitlement_ids: ['plus'],
  event_timestamp_ms: T('2026-11-06T12:00:00Z'),
  expiration_at_ms: T('2026-12-06T12:00:00Z'),
};

describe('applyRevenueCatEvent', () => {
  it.each(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE'])(
    '%s grants plus until the stated expiry and clears grace',
    type => {
      const result = applyRevenueCatEvent({ ...base, type }, null);
      expect(result).toEqual({
        userId: 'user-1',
        entitlement: 'plus',
        expiresAt: '2026-12-06T12:00:00.000Z',
        graceExpiresAt: null,
        autoRenew: type !== 'NON_RENEWING_PURCHASE',
        lastEventMs: base.event_timestamp_ms,
      });
    },
  );

  it('CANCELLATION keeps the period but stops auto-renew', () => {
    const result = applyRevenueCatEvent({ ...base, type: 'CANCELLATION' }, null);
    expect(result?.expiresAt).toBe('2026-12-06T12:00:00.000Z');
    expect(result?.autoRenew).toBe(false);
  });

  it('BILLING_ISSUE records the grace window', () => {
    const result = applyRevenueCatEvent(
      { ...base, type: 'BILLING_ISSUE', grace_period_expiration_at_ms: T('2026-11-16T12:00:00Z') },
      null,
    );
    expect(result?.graceExpiresAt).toBe('2026-11-16T12:00:00.000Z');
  });

  it('EXPIRATION ends access at the event expiry and clears grace', () => {
    const result = applyRevenueCatEvent(
      { ...base, type: 'EXPIRATION', expiration_at_ms: T('2026-11-06T11:00:00Z') },
      { graceExpiresAt: '2026-11-16T12:00:00.000Z', lastEventMs: 0 } as StoredSubscription,
    );
    expect(result?.expiresAt).toBe('2026-11-06T11:00:00.000Z');
    expect(result?.graceExpiresAt).toBeNull();
    expect(result?.autoRenew).toBe(false);
  });

  it('ignores an event older than the one already applied (out-of-order delivery)', () => {
    const stored = { lastEventMs: base.event_timestamp_ms + 1 } as StoredSubscription;
    expect(applyRevenueCatEvent({ ...base, type: 'RENEWAL' }, stored)).toBeNull();
  });

  it('ignores TEST, unknown types, other entitlements and anonymous users', () => {
    expect(applyRevenueCatEvent({ ...base, type: 'TEST' }, null)).toBeNull();
    expect(applyRevenueCatEvent({ ...base, type: 'SOMETHING_NEW' }, null)).toBeNull();
    expect(applyRevenueCatEvent({ ...base, type: 'RENEWAL', entitlement_ids: ['other'] }, null)).toBeNull();
    expect(applyRevenueCatEvent({ ...base, type: 'RENEWAL', app_user_id: '$RCAnonymousID:abc' }, null)).toBeNull();
  });

  it('ignores a grant with no usable expiry rather than granting forever', () => {
    expect(applyRevenueCatEvent({ ...base, type: 'RENEWAL', expiration_at_ms: null }, null)).toBeNull();
  });
});
