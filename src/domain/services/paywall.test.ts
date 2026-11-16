import type { PlusPackage } from '../entities/Subscription';
import { bestValuePackageId, isLockedOut, packageTitle, savingsPercent, trialLabel } from './paywall';

const monthly: PlusPackage = { id: 'm', period: 'monthly', priceLabel: '$12.99', price: 12.99, trialDays: 7 };
const yearly: PlusPackage = { id: 'y', period: 'yearly', priceLabel: '$99.00', price: 99, trialDays: 7 };

describe('paywall copy', () => {
  it('titles each period', () => {
    expect(packageTitle('monthly')).toBe('Monthly');
    expect(packageTitle('yearly')).toBe('Yearly');
  });

  it('labels a trial in days, weeks or none', () => {
    expect(trialLabel(null)).toBeNull();
    expect(trialLabel(0)).toBeNull();
    expect(trialLabel(1)).toBe('1-day free trial');
    expect(trialLabel(7)).toBe('7-day free trial');
    expect(trialLabel(14)).toBe('14-day free trial');
  });

  it('computes the yearly saving against twelve months, rounded down', () => {
    expect(savingsPercent(monthly, yearly)).toBe(36);
  });

  it('reports no saving when yearly is not cheaper or prices are unusable', () => {
    expect(savingsPercent(monthly, { ...yearly, price: 200 })).toBeNull();
    expect(savingsPercent(monthly, { ...yearly, price: 0 })).toBeNull();
    expect(savingsPercent({ ...monthly, price: 0 }, yearly)).toBeNull();
  });

  it('highlights yearly only when it actually saves money', () => {
    expect(bestValuePackageId([monthly, yearly])).toBe('y');
    expect(bestValuePackageId([monthly, { ...yearly, price: 200 }])).toBeNull();
    expect(bestValuePackageId([monthly])).toBeNull();
  });
});

describe('isLockedOut', () => {
  const view = (available: boolean, active: boolean): { available: boolean; active: boolean } => ({ available, active });

  it('never locks while the requirement is off (the paywall ships dark)', () => {
    expect(isLockedOut(view(true, false), false)).toBe(false);
  });

  it('locks only when purchasing works, the requirement is on, and Plus is not active', () => {
    expect(isLockedOut(view(true, false), true)).toBe(true);
    expect(isLockedOut(view(true, true), true)).toBe(false);
  });

  it('never locks a build that cannot sell anything (dev, CI)', () => {
    expect(isLockedOut(view(false, false), true)).toBe(false);
  });

  it('never locks on an unknown state: the server enforces, the client must not strand a payer', () => {
    expect(isLockedOut(undefined, true)).toBe(false);
  });
});
