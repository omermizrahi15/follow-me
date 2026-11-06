import type { PlusOffering, PlusPackage, PurchaseOutcome } from '../../domain/entities/Subscription';
import type { IPurchaseService } from '../../domain/interfaces';

/** The entitlement id configured in RevenueCat (mirrors PLUS_ENTITLEMENT in plans.ts). */
const PLUS_ENTITLEMENT = 'plus';

interface SdkIntro { price: number; periodUnit: string; periodNumberOfUnits: number }
interface SdkPackage {
  identifier: string;
  packageType: string;
  product: { price: number; priceString: string; introPrice?: SdkIntro | null };
}
interface SdkCustomerInfo { entitlements: { active: Record<string, unknown> } }

/**
 * The slice of `react-native-purchases` this service uses. Injected so the
 * mapping logic is tested without the native module, which cannot load in Jest.
 */
export interface PurchasesSdk {
  configure(options: { apiKey: string }): void;
  logIn(appUserId: string): Promise<{ customerInfo: SdkCustomerInfo }>;
  getOfferings(): Promise<{ current: { availablePackages: SdkPackage[] } | null }>;
  purchasePackage(pkg: SdkPackage): Promise<{ customerInfo: SdkCustomerInfo }>;
  restorePurchases(): Promise<SdkCustomerInfo>;
  getCustomerInfo(): Promise<SdkCustomerInfo>;
}

const PERIOD_DAYS: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };

function hasPlus(info: SdkCustomerInfo): boolean {
  return info.entitlements.active[PLUS_ENTITLEMENT] != null;
}

/** Free-trial length in days; a discounted (non-zero) intro price is not a trial. */
function trialDays(intro: SdkIntro | null | undefined): number | null {
  if (intro == null || intro.price !== 0) return null;
  const unit = PERIOD_DAYS[intro.periodUnit];
  return unit == null ? null : unit * intro.periodNumberOfUnits;
}

function toPackage(pkg: SdkPackage): PlusPackage | null {
  const period = pkg.packageType === 'MONTHLY' ? 'monthly' : pkg.packageType === 'ANNUAL' ? 'yearly' : null;
  if (period == null) return null;
  return {
    id: pkg.identifier,
    period,
    priceLabel: pkg.product.priceString,
    price: pkg.product.price,
    trialDays: trialDays(pkg.product.introPrice),
  };
}

/**
 * Plus purchases through RevenueCat (issue #252).
 *
 * The store account is tied to the Supabase user id (`logIn`) so the server
 * webhook can find the user. With no API key (dev, CI) the service reports
 * itself unavailable and never touches the SDK.
 */
export class RevenueCatPurchaseService implements IPurchaseService {
  private configured = false;
  private loggedInAs: string | null = null;

  constructor(
    private readonly sdk: PurchasesSdk,
    private readonly apiKey: string,
  ) {}

  get available(): boolean {
    return this.apiKey !== '';
  }

  private async identify(userId: string): Promise<void> {
    if (!this.configured) {
      this.sdk.configure({ apiKey: this.apiKey });
      this.configured = true;
    }
    if (this.loggedInAs !== userId) {
      await this.sdk.logIn(userId);
      this.loggedInAs = userId;
    }
  }

  async getOffering(userId: string): Promise<PlusOffering | null> {
    if (!this.available) return null;
    await this.identify(userId);
    const { current } = await this.sdk.getOfferings();
    const packages = (current?.availablePackages ?? []).map(toPackage).filter((p): p is PlusPackage => p != null);
    return packages.length === 0 ? null : { packages };
  }

  async purchase(userId: string, packageId: string): Promise<PurchaseOutcome> {
    if (!this.available) throw new Error('purchases are not available in this build');
    await this.identify(userId);
    const { current } = await this.sdk.getOfferings();
    const pkg = current?.availablePackages.find(p => p.identifier === packageId);
    if (pkg == null) throw new Error('that plan is no longer available');
    try {
      const { customerInfo } = await this.sdk.purchasePackage(pkg);
      // Paid but nothing unlocked would be a silent failure the user already paid for.
      if (!hasPlus(customerInfo)) throw new Error('purchase completed but Plus did not activate');
      return 'purchased';
    } catch (err) {
      if ((err as { userCancelled?: boolean } | null)?.userCancelled === true) return 'cancelled';
      throw err;
    }
  }

  async restore(userId: string): Promise<boolean> {
    if (!this.available) return false;
    await this.identify(userId);
    return hasPlus(await this.sdk.restorePurchases());
  }

  async hasPlus(userId: string): Promise<boolean> {
    if (!this.available) return false;
    await this.identify(userId);
    return hasPlus(await this.sdk.getCustomerInfo());
  }
}
