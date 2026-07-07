import { useCallback, useEffect, useState } from 'react';
import { loadConfig, suggestPhotos } from '../../composition/container';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import { SuggestionCache, cachedPhotoToClassification, classificationToCachedPhoto } from '../../infrastructure/cache/SuggestionCache';

export type SuggestPhase = 'loading' | 'scanning' | 'classifying' | 'done' | 'error';

interface State {
  phase: SuggestPhase;
  /** Total photos found in the lookback window (before burst-dedup). */
  found: number;
  /** Unique photos after burst-dedup — the actual count being classified. */
  unique: number;
  /** How many photos have been classified so far. */
  classified: number;
  /** Total photos being classified (= unique). */
  total: number;
  /**
   * The AI-*selected* photos accumulated so far during classification — this is
   * the running batch (result of selectBatch on everything classified up to now),
   * NOT every photo the AI has looked at. Shown as the live preview.
   */
  partial: PhotoClassification[];
  /** Final AI-selected batch (populated when phase === 'done'). */
  batch: PhotoClassification[];
  /**
   * Classified photos not chosen for the initial batch — used to fill slots
   * when the user removes a photo. Sorted by quality descending.
   */
  pool: PhotoClassification[];
  /** How many photos the publisher wants per post. */
  photosPerPost: number;
  /** True when the batch was loaded from the server-push cache (no scan ran). */
  fromCache: boolean;
  error: string | null;
}

const INITIAL: State = {
  phase: 'loading',
  found: 0,
  unique: 0,
  classified: 0,
  total: 0,
  partial: [],
  batch: [],
  pool: [],
  photosPerPost: 0,
  fromCache: false,
  error: null,
};

export function useSuggestedPhotos(publisherId: string): State & { reload: () => void } {
  const [state, setState] = useState<State>(INITIAL);

  const runScan = useCallback((skipCache: boolean): void => {
    setState(INITIAL);

    // Safety net: the navigator guards this screen behind auth, but if it ever
    // mounts without a publisher (e.g. mid-logout) fail visibly, don't scan.
    if (!publisherId) {
      setState(s => ({ ...s, phase: 'error', error: 'Not signed in' }));
      return;
    }

    void (async (): Promise<void> => {
      try {
        const config = await loadConfig.execute(publisherId);
        setState(s => ({ ...s, photosPerPost: config.photosPerPost }));

        // Use the server-pre-computed batch when available (skips the full scan).
        if (!skipCache) {
          const cached = await SuggestionCache.load(publisherId);
          if (cached != null) {
            const batch = cached.batch.map(cachedPhotoToClassification);
            const pool = cached.pool.map(cachedPhotoToClassification);
            setState(s => ({ ...s, phase: 'done', batch, pool, fromCache: true, error: null }));
            return;
          }
        }

        // No cache — transition to scanning UI now and run a full device scan.
        setState(s => ({ ...s, phase: 'scanning' }));
        await SuggestionCache.clear(publisherId);

        const { batch, pool } = await suggestPhotos.execute(config, {
          onScanning() {
            setState(s => ({ ...s, phase: 'scanning' }));
          },
          onScanned(found, unique) {
            setState(s => ({ ...s, found, unique }));
          },
          onClassifying(index, total, currentBatch) {
            setState(s => ({
              ...s,
              phase: 'classifying',
              classified: index,
              total,
              partial: currentBatch,
            }));
          },
        });

        setState(s => ({ ...s, phase: 'done', classified: 0, total: 0, partial: [], batch, pool, fromCache: false, error: null }));

        // Persist the scan result so reopening the screen (or tapping the
        // reminder) shows this batch instantly instead of rescanning.
        // Empty batches are not cached — a rescan should always retry.
        if (batch.length === 0) return;
        void SuggestionCache.save({
          publisherId,
          batch: batch.map(classificationToCachedPhoto),
          pool: pool.map(classificationToCachedPhoto),
          batchId: `scan-${Date.now()}`,
          cachedAt: Date.now(),
        }).catch(() => undefined);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Could not build suggestions';
        setState(s => ({ ...s, phase: 'error', error: message }));
      }
    })();
  }, [publisherId]);

  // On mount: check cache first.
  useEffect(() => runScan(false), [runScan]);

  // Exposed `reload` always does a fresh device scan (ignores cache).
  const reload = useCallback(() => runScan(true), [runScan]);

  return { ...state, reload };
}
