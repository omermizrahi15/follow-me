import { PLANS, PLUS_ENTITLEMENT, limitsFor, planFromSubscription, recipientsWithinBudget } from './plans';

const NOW = new Date('2026-11-06T12:00:00Z');
const FUTURE = '2026-12-06T12:00:00Z';
const PAST = '2026-10-06T12:00:00Z';

describe('PLANS', () => {
  it('has no free tier: without a subscription nothing that costs money is allowed', () => {
    expect(PLANS.none).toEqual({ aiPhotosPerDay: 0, whatsappMessagesPerMonth: 0, followers: 0 });
  });

  it('Plus matches the costed numbers (issue #252): 200 AI photos/day, 1000 messages/month', () => {
    expect(PLANS.plus.aiPhotosPerDay).toBe(200);
    expect(PLANS.plus.whatsappMessagesPerMonth).toBe(1000);
  });

  it('Plus allows something on every limit', () => {
    expect(PLANS.plus.aiPhotosPerDay).toBeGreaterThan(0);
    expect(PLANS.plus.whatsappMessagesPerMonth).toBeGreaterThan(0);
    expect(PLANS.plus.followers).toBeGreaterThan(0);
  });

  it('limitsFor returns the table row', () => {
    expect(limitsFor('none')).toBe(PLANS.none);
    expect(limitsFor('plus')).toBe(PLANS.plus);
  });
});

describe('planFromSubscription', () => {
  it('is free with no subscription', () => {
    expect(planFromSubscription(null, NOW)).toBe('none');
  });

  it('is plus while the paid period has not ended', () => {
    expect(planFromSubscription({ entitlement: 'plus', expiresAt: FUTURE, graceExpiresAt: null }, NOW)).toBe('plus');
  });

  it('stays plus after cancelling until the period ends (cancel only stops renewal)', () => {
    expect(planFromSubscription({ entitlement: 'plus', expiresAt: FUTURE, graceExpiresAt: null }, NOW)).toBe('plus');
  });

  it('falls back to free once expired', () => {
    expect(planFromSubscription({ entitlement: 'plus', expiresAt: PAST, graceExpiresAt: null }, NOW)).toBe('none');
  });

  it('keeps plus during a billing-retry grace window', () => {
    expect(planFromSubscription({ entitlement: 'plus', expiresAt: PAST, graceExpiresAt: FUTURE }, NOW)).toBe('plus');
  });

  it('is free once the grace window has also passed', () => {
    expect(planFromSubscription({ entitlement: 'plus', expiresAt: PAST, graceExpiresAt: PAST }, NOW)).toBe('none');
  });

  it('fails closed to free on unknown entitlements, missing or unparseable dates', () => {
    expect(planFromSubscription({ entitlement: 'gold', expiresAt: FUTURE, graceExpiresAt: null }, NOW)).toBe('none');
    expect(planFromSubscription({ entitlement: 'plus', expiresAt: null, graceExpiresAt: null }, NOW)).toBe('none');
    expect(planFromSubscription({ entitlement: 'plus', expiresAt: 'garbage', graceExpiresAt: null }, NOW)).toBe('none');
  });
});

import fs from 'fs';
import path from 'path';

it('repeats the entitlement id in revenueCatEvents.ts (dual-runtime: cannot import it)', () => {
  const source = fs.readFileSync(path.join(__dirname, 'revenueCatEvents.ts'), 'utf8');
  expect(source).toContain(`const ENTITLEMENT = '${PLUS_ENTITLEMENT}'`);
});

describe('recipientsWithinBudget', () => {
  it('serves everyone when no budget applies', () => {
    expect(recipientsWithinBudget(null, 30, 1)).toBe(30);
  });

  it('serves nobody when the budget is spent', () => {
    expect(recipientsWithinBudget(0, 30, 1)).toBe(0);
    expect(recipientsWithinBudget(-5, 30, 1)).toBe(0);
  });

  it('trims to what is left, never above the recipient count', () => {
    expect(recipientsWithinBudget(12, 30, 1)).toBe(12);
    expect(recipientsWithinBudget(100, 30, 1)).toBe(30);
  });

  it('never half-serves a recipient who costs several messages', () => {
    expect(recipientsWithinBudget(10, 30, 4)).toBe(2);
    expect(recipientsWithinBudget(3, 30, 4)).toBe(0);
  });
});
