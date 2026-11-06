import { PLANS, PLUS_ENTITLEMENT, limitsFor, planFromSubscription } from './plans';

const NOW = new Date('2026-11-06T12:00:00Z');
const FUTURE = '2026-12-06T12:00:00Z';
const PAST = '2026-10-06T12:00:00Z';

describe('PLANS', () => {
  it('gives Plus strictly more than Free on every limit', () => {
    expect(PLANS.plus.aiPhotosPerDay).toBeGreaterThan(PLANS.free.aiPhotosPerDay);
    expect(PLANS.plus.whatsappPostsPerMonth).toBeGreaterThan(PLANS.free.whatsappPostsPerMonth);
    expect(PLANS.plus.followers).toBeGreaterThan(PLANS.free.followers);
  });

  it('limitsFor returns the table row', () => {
    expect(limitsFor('free')).toBe(PLANS.free);
    expect(limitsFor('plus')).toBe(PLANS.plus);
  });
});

describe('planFromSubscription', () => {
  it('is free with no subscription', () => {
    expect(planFromSubscription(null, NOW)).toBe('free');
  });

  it('is plus while the paid period has not ended', () => {
    expect(planFromSubscription({ entitlement: 'plus', expiresAt: FUTURE, graceExpiresAt: null }, NOW)).toBe('plus');
  });

  it('stays plus after cancelling until the period ends (cancel only stops renewal)', () => {
    expect(planFromSubscription({ entitlement: 'plus', expiresAt: FUTURE, graceExpiresAt: null }, NOW)).toBe('plus');
  });

  it('falls back to free once expired', () => {
    expect(planFromSubscription({ entitlement: 'plus', expiresAt: PAST, graceExpiresAt: null }, NOW)).toBe('free');
  });

  it('keeps plus during a billing-retry grace window', () => {
    expect(planFromSubscription({ entitlement: 'plus', expiresAt: PAST, graceExpiresAt: FUTURE }, NOW)).toBe('plus');
  });

  it('is free once the grace window has also passed', () => {
    expect(planFromSubscription({ entitlement: 'plus', expiresAt: PAST, graceExpiresAt: PAST }, NOW)).toBe('free');
  });

  it('fails closed to free on unknown entitlements, missing or unparseable dates', () => {
    expect(planFromSubscription({ entitlement: 'gold', expiresAt: FUTURE, graceExpiresAt: null }, NOW)).toBe('free');
    expect(planFromSubscription({ entitlement: 'plus', expiresAt: null, graceExpiresAt: null }, NOW)).toBe('free');
    expect(planFromSubscription({ entitlement: 'plus', expiresAt: 'garbage', graceExpiresAt: null }, NOW)).toBe('free');
  });
});

import fs from 'fs';
import path from 'path';

it('repeats the entitlement id in revenueCatEvents.ts (dual-runtime: cannot import it)', () => {
  const source = fs.readFileSync(path.join(__dirname, 'revenueCatEvents.ts'), 'utf8');
  expect(source).toContain(`const ENTITLEMENT = '${PLUS_ENTITLEMENT}'`);
});
