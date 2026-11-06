import type { PurchasesSdk } from './RevenueCatPurchaseService';

/**
 * The real `react-native-purchases`, loaded on first use.
 *
 * Lazy because the native module cannot load in Jest or in a build without it:
 * a top-level import would break every test that touches the container.
 */
export function purchasesSdk(): PurchasesSdk {
  const load = (): PurchasesSdk =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access
    require('react-native-purchases').default as PurchasesSdk;
  return {
    configure: options => load().configure(options),
    logIn: id => load().logIn(id),
    getOfferings: () => load().getOfferings(),
    purchasePackage: pkg => load().purchasePackage(pkg),
    restorePurchases: () => load().restorePurchases(),
    getCustomerInfo: () => load().getCustomerInfo(),
  };
}
