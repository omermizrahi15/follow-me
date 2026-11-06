import type { PlusOffering, PurchaseOutcome } from '../../domain/entities/Subscription';
import type { IPurchaseService } from '../../domain/interfaces';

export interface PlusOfferingView {
  /** False in builds with no store key — the paywall explains instead of failing. */
  readonly available: boolean;
  readonly offering: PlusOffering | null;
  /** The store says Plus is already active (display only; the server decides access). */
  readonly active: boolean;
}

/** What the paywall shows: what can be bought, and whether Plus is already on. */
export class GetPlusOfferingUseCase {
  constructor(private readonly purchases: IPurchaseService) {}

  async execute(userId: string): Promise<PlusOfferingView> {
    if (!this.purchases.available) return { available: false, offering: null, active: false };
    const [offering, active] = await Promise.all([
      this.purchases.getOffering(userId),
      this.purchases.hasPlus(userId),
    ]);
    return { available: true, offering, active };
  }
}

export class PurchasePlusUseCase {
  constructor(private readonly purchases: IPurchaseService) {}

  execute(userId: string, packageId: string): Promise<PurchaseOutcome> {
    return this.purchases.purchase(userId, packageId);
  }
}

export class RestorePurchasesUseCase {
  constructor(private readonly purchases: IPurchaseService) {}

  execute(userId: string): Promise<boolean> {
    return this.purchases.restore(userId);
  }
}
