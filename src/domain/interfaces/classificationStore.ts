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
  /**
   * Grades already held for `assetIds`, keyed by asset id. Missing ids are
   * simply absent.
   *
   * `referenceKey` identifies the face the caller needs answered (issue #137) —
   * in practice the publisher's profile photo URL, or '' when the "photos of
   * me" preference is off and the question isn't being asked. A grade recorded
   * under a *different* key is not a hit: it was bought without that face being
   * looked for, so its `containsPublisher` is "nobody asked", and serving it
   * would rank photos of the publisher as though they weren't in them. An empty
   * key matches everything, because a caller who doesn't care about the face
   * can use any grade regardless of how it was bought.
   */
  load(assetIds: readonly string[], referenceKey?: string): Promise<Map<string, PhotoClassification>>;
  /**
   * Records freshly bought grades. Overwrites any existing entry for the same
   * asset. `referenceKey` is the face these grades were bought under, and is
   * what a later `load` matches against.
   */
  save(classifications: readonly PhotoClassification[], referenceKey?: string): Promise<void>;
  /**
   * Every grade currently remembered, newest photo first.
   *
   * The odd one out here: `load` answers "what do we already know about these
   * particular photos", which is what a scan asks. This answers "what does the
   * AI think of everything it has ever looked at", which nothing could ask at
   * all — and which is the only question the grade inspector has, since it
   * starts from no id list and no window.
   *
   * `referenceKey` filters exactly as `load`'s does: a grade bought without a
   * face being looked for says `containsPublisher: false` for the trivial
   * reason that nobody asked, and serving it under a face key would rank photos
   * of the publisher as though they were not in them.
   */
  loadAll(referenceKey?: string): Promise<PhotoClassification[]>;
}
