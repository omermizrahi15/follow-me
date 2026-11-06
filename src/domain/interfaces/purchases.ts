import type { PlusOffering, PurchaseOutcome } from '../entities/Subscription';

/**
 * Buying and checking Plus through the app store.
 *
 * Client-side knowledge is for DISPLAY only — the server decides what a user may
 * do from its own `subscriptions` row (issue #252). `userId` is the Supabase user
 * id: the store account is tied to it so the server webhook can find the user.
 */
export interface IPurchaseService {
  /** False when the build has no store key (dev, CI): the paywall says so instead of failing. */
  readonly available: boolean;
  /** What can be bought, or null when nothing is on sale. */
  getOffering(userId: string): Promise<PlusOffering | null>;
  purchase(userId: string, packageId: string): Promise<PurchaseOutcome>;
  /** Re-attaches an earlier purchase (new phone, reinstall). True when Plus is active afterwards. */
  restore(userId: string): Promise<boolean>;
  /** Whether the store says Plus is active right now. */
  hasPlus(userId: string): Promise<boolean>;
}
