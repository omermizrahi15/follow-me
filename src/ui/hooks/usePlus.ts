import { useCallback, useState } from 'react';
import { getPlusOffering, purchasePlus, requirePlus, restorePurchases } from '../../composition/container';
import type { PlusOfferingView } from '../../application/usecases/PurchaseUseCases';
import { isLockedOut } from '../../domain/services/paywall';
import { useCachedQuery } from './useCachedQuery';

export type PlusAction = 'purchasing' | 'restoring' | null;

export interface PlusState {
  view: PlusOfferingView | undefined;
  loading: boolean;
  error: unknown;
  /** The app should show only the paywall (EXPO_PUBLIC_REQUIRE_PLUS, no active Plus). */
  locked: boolean;
  busy: PlusAction;
  /** A message to show after the last action, or null. */
  notice: string | null;
  purchase: (packageId: string) => Promise<void>;
  restore: () => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * Plus offering and purchase actions for the signed-in publisher (issue #252).
 * The store's answer is display-only; the server enforces from its own record.
 */
export function usePlus(publisherId: string | null): PlusState {
  const query = useCachedQuery<PlusOfferingView>(
    publisherId == null ? null : `plus:${publisherId}`,
    () => getPlusOffering.execute(publisherId as string),
    { staleTime: 30_000, revalidateOnFocus: true },
  );
  const [busy, setBusy] = useState<PlusAction>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { reload } = query;

  const purchase = useCallback(async (packageId: string): Promise<void> => {
    if (publisherId == null) return;
    setBusy('purchasing');
    setNotice(null);
    try {
      const outcome = await purchasePlus.execute(publisherId, packageId);
      if (outcome === 'purchased') await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'The purchase failed. You were not charged.');
    } finally {
      setBusy(null);
    }
  }, [publisherId, reload]);

  const restore = useCallback(async (): Promise<void> => {
    if (publisherId == null) return;
    setBusy('restoring');
    setNotice(null);
    try {
      const active = await restorePurchases.execute(publisherId);
      setNotice(active ? null : 'No earlier purchase was found for this Apple ID.');
      if (active) await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not restore purchases.');
    } finally {
      setBusy(null);
    }
  }, [publisherId, reload]);

  return {
    view: query.data,
    loading: query.loading,
    error: query.error,
    locked: isLockedOut(query.data, requirePlus),
    busy,
    notice,
    purchase,
    restore,
    reload,
  };
}
