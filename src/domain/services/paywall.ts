import type { PlusPackage, PlusPeriod } from '../entities/Subscription';

export function packageTitle(period: PlusPeriod): string {
  return period === 'yearly' ? 'Yearly' : 'Monthly';
}

/** "7-day free trial", or null when there is none to advertise. */
export function trialLabel(days: number | null): string | null {
  return days != null && days > 0 ? `${days}-day free trial` : null;
}

/** Percent saved by paying yearly instead of twelve months, or null when it saves nothing. */
export function savingsPercent(monthly: PlusPackage, yearly: PlusPackage): number | null {
  if (!(monthly.price > 0) || !(yearly.price > 0)) return null;
  const saved = 1 - yearly.price / (monthly.price * 12);
  return saved > 0 ? Math.floor(saved * 100) : null;
}

/** The package to flag "best value": the yearly one, but only when it truly is cheaper. */
export function bestValuePackageId(packages: readonly PlusPackage[]): string | null {
  const monthly = packages.find(p => p.period === 'monthly');
  const yearly = packages.find(p => p.period === 'yearly');
  if (monthly == null || yearly == null) return null;
  return savingsPercent(monthly, yearly) != null ? yearly.id : null;
}

/**
 * Whether the app should show only the paywall.
 *
 * Fails OPEN on anything unknown: this is a display decision, the server is what
 * actually refuses a non-subscriber, and a client that locks on a failed store
 * lookup would strand someone who already paid.
 */
export function isLockedOut(
  view: { available: boolean; active: boolean } | undefined,
  requirePlus: boolean,
): boolean {
  return requirePlus && view != null && view.available && !view.active;
}
