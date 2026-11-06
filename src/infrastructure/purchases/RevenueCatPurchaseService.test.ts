/* eslint-disable @typescript-eslint/unbound-method -- asserting on jest mocks */
import { RevenueCatPurchaseService, type PurchasesSdk } from './RevenueCatPurchaseService';

function info(plus: boolean): { entitlements: { active: Record<string, unknown> } } {
  return { entitlements: { active: plus ? { plus: {} } : {} } };
}

function sdk(overrides: Partial<PurchasesSdk> = {}): jest.Mocked<PurchasesSdk> {
  return {
    configure: jest.fn(),
    logIn: jest.fn().mockResolvedValue({ customerInfo: info(false) }),
    getOfferings: jest.fn().mockResolvedValue({ current: null }),
    purchasePackage: jest.fn().mockResolvedValue({ customerInfo: info(true) }),
    restorePurchases: jest.fn().mockResolvedValue(info(true)),
    getCustomerInfo: jest.fn().mockResolvedValue(info(true)),
    ...overrides,
  } as jest.Mocked<PurchasesSdk>;
}

const MONTHLY = {
  identifier: '$rc_monthly',
  packageType: 'MONTHLY',
  product: { price: 12.99, priceString: '$12.99', introPrice: { price: 0, periodUnit: 'WEEK', periodNumberOfUnits: 1 } },
};
const YEARLY = {
  identifier: '$rc_annual',
  packageType: 'ANNUAL',
  product: { price: 99, priceString: '$99.00', introPrice: null },
};
const offeringOf = (...pkgs: unknown[]): jest.Mock => jest.fn().mockResolvedValue({ current: { availablePackages: pkgs } });

describe('RevenueCatPurchaseService', () => {
  it('is unavailable with no key and never touches the sdk', async () => {
    const s = sdk();
    const service = new RevenueCatPurchaseService(s, '');
    expect(service.available).toBe(false);
    expect(await service.getOffering('u1')).toBeNull();
    expect(await service.hasPlus('u1')).toBe(false);
    expect(await service.restore('u1')).toBe(false);
    expect(s.configure).not.toHaveBeenCalled();
  });

  it('configures once and logs in as the Supabase user before reading', async () => {
    const s = sdk();
    const service = new RevenueCatPurchaseService(s, 'key');
    await service.hasPlus('u1');
    await service.hasPlus('u1');
    expect(s.configure).toHaveBeenCalledTimes(1);
    expect(s.configure).toHaveBeenCalledWith({ apiKey: 'key' });
    expect(s.logIn).toHaveBeenCalledTimes(1);
    expect(s.logIn).toHaveBeenCalledWith('u1');
  });

  it('logs in again when a different user signs in', async () => {
    const s = sdk();
    const service = new RevenueCatPurchaseService(s, 'key');
    await service.hasPlus('u1');
    await service.hasPlus('u2');
    expect(s.logIn).toHaveBeenCalledTimes(2);
  });

  it('maps the current offering to monthly/yearly packages with trial days', async () => {
    const s = sdk({ getOfferings: offeringOf(MONTHLY, YEARLY) });
    const offering = await new RevenueCatPurchaseService(s, 'key').getOffering('u1');
    expect(offering?.packages).toEqual([
      { id: '$rc_monthly', period: 'monthly', priceLabel: '$12.99', price: 12.99, trialDays: 7 },
      { id: '$rc_annual', period: 'yearly', priceLabel: '$99.00', price: 99, trialDays: null },
    ]);
  });

  it('ignores packages that are not monthly or yearly, and returns null when none are left', async () => {
    const s = sdk({ getOfferings: offeringOf({ ...MONTHLY, packageType: 'WEEKLY' }) });
    expect(await new RevenueCatPurchaseService(s, 'key').getOffering('u1')).toBeNull();
  });

  it('purchases the chosen package and reports purchased when Plus is active', async () => {
    const s = sdk({ getOfferings: offeringOf(MONTHLY, YEARLY) });
    const outcome = await new RevenueCatPurchaseService(s, 'key').purchase('u1', '$rc_annual');
    expect(s.purchasePackage).toHaveBeenCalledWith(YEARLY);
    expect(outcome).toBe('purchased');
  });

  it('reports cancelled (not an error) when the user backs out', async () => {
    const s = sdk({
      getOfferings: offeringOf(MONTHLY),
      purchasePackage: jest.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { userCancelled: true })),
    });
    expect(await new RevenueCatPurchaseService(s, 'key').purchase('u1', '$rc_monthly')).toBe('cancelled');
  });

  it('rethrows real purchase failures', async () => {
    const s = sdk({
      getOfferings: offeringOf(MONTHLY),
      purchasePackage: jest.fn().mockRejectedValue(new Error('card declined')),
    });
    await expect(new RevenueCatPurchaseService(s, 'key').purchase('u1', '$rc_monthly')).rejects.toThrow('card declined');
  });

  it('throws when the package is no longer on sale', async () => {
    const s = sdk({ getOfferings: offeringOf(MONTHLY) });
    await expect(new RevenueCatPurchaseService(s, 'key').purchase('u1', 'gone')).rejects.toThrow(/no longer available/);
  });

  it('a purchase that does not activate Plus is an error, not a success', async () => {
    const s = sdk({
      getOfferings: offeringOf(MONTHLY),
      purchasePackage: jest.fn().mockResolvedValue({ customerInfo: info(false) }),
    });
    await expect(new RevenueCatPurchaseService(s, 'key').purchase('u1', '$rc_monthly')).rejects.toThrow(/did not activate/);
  });

  it('restore returns whether Plus is active', async () => {
    expect(await new RevenueCatPurchaseService(sdk(), 'key').restore('u1')).toBe(true);
    const none = sdk({ restorePurchases: jest.fn().mockResolvedValue(info(false)) });
    expect(await new RevenueCatPurchaseService(none, 'key').restore('u1')).toBe(false);
  });
});
