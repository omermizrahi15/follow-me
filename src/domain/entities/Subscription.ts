/** How often a Plus package bills. */
export type PlusPeriod = 'monthly' | 'yearly';

/**
 * One way to buy Plus, as the store prices it. Prices come from the store, never
 * from us: they differ by country and currency, and showing a number the store
 * will not charge is how a paywall gets an app rejected.
 */
export interface PlusPackage {
  /** The store/RevenueCat package id, passed back to purchase. */
  readonly id: string;
  readonly period: PlusPeriod;
  /** Localised, ready to render ("$12.99"). */
  readonly priceLabel: string;
  /** The numeric price in the store currency, for comparing packages only. */
  readonly price: number;
  /** Length of the free trial in days, or null when the package has none. */
  readonly trialDays: number | null;
}

export interface PlusOffering {
  readonly packages: readonly PlusPackage[];
}

/** What a purchase attempt ended in. A failure is thrown, never returned. */
export type PurchaseOutcome = 'purchased' | 'cancelled';
