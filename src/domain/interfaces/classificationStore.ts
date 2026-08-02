import type { PhotoClassification } from '../entities/PhotoClassification';

/**
 * Remembers what the AI already decided about a photo, keyed by library asset id.
 *
 * Classification is the only part of a scan that costs real money and a real
 * daily quota, and a grade is a property of the *photo* — it does not change
 * because the window moved, the screen was reopened, or the publisher tweaked
 * their categories. Without this every scan re-bought grades it had already
 * paid for, which is what kept the classified set small enough to be useless
 * (a hard stop at 2× the quota) and made every swap a live network round.
 *
 * Implementations are best-effort: a miss costs one classification, never
 * correctness, so callers should treat any failure as an empty result rather
 * than an error worth surfacing.
 */
export interface IClassificationStore {
  /** Grades already held for `assetIds`, keyed by asset id. Missing ids are simply absent. */
  load(assetIds: readonly string[]): Promise<Map<string, PhotoClassification>>;
  /** Records freshly bought grades. Overwrites any existing entry for the same asset. */
  save(classifications: readonly PhotoClassification[]): Promise<void>;
}
