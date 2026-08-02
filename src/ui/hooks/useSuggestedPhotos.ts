import { useCallback, useEffect, useRef, useState } from 'react';
import { loadConfig, suggestPhotos } from '../../composition/container';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import { SuggestionCache, cachedPhotoToClassification, classificationToCachedPhoto } from '../../infrastructure/cache/SuggestionCache';

export type SuggestPhase = 'loading' | 'scanning' | 'classifying' | 'done' | 'error';

/** Outcome of one "give me another photo" request. */
export interface TopUpResult {
  /** Newly classified photos worth suggesting — empty when the AI found none. */
  suggestions: PhotoClassification[];
  /** Why it came back empty, for the caller's copy. Null when it didn't. */
  reason: 'none' | 'quota' | null;
}

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
  /**
   * The config the scan ran with — the review screen needs `enabledCategories`
   * to tell an offerable photo from one the publisher switched off.
   */
  config: PublisherConfig | null;
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
  config: null,
  fromCache: false,
  error: null,
};

interface Controls {
  /** Rescan the library from scratch, ignoring any cached batch. */
  reload: () => void;
  /**
   * Classify more of the window and hand back the next photo(s) worth showing.
   * Each call appends everything it classified to `pool`, so a photo the caller
   * decides not to use is still available for a later swap.
   *
   * Calling it while one is already running joins that round rather than
   * starting a second — so a tap that lands during a background prefetch is
   * answered by the prefetch instead of coming back empty-handed.
   */
  topUp: () => Promise<TopUpResult>;
  /** A top-up is in flight. */
  toppingUp: boolean;
  /**
   * Whether asking for more is still worth doing. Starts optimistic — a cached
   * batch carries no record of what is left unclassified — and goes false once
   * the window is provably spent (or the day's AI budget is).
   */
  canTopUp: boolean;
}

export function useSuggestedPhotos(publisherId: string): State & Controls {
  const [state, setState] = useState<State>(INITIAL);
  const [toppingUp, setToppingUp] = useState(false);
  const [canTopUp, setCanTopUp] = useState(true);
  /** Not-yet-classified candidates, built on the first top-up and walked down. */
  const pendingRef = useRef<PhotoCandidate[] | null>(null);
  /** Every candidate id already on screen — never queue one of these again. */
  const knownRef = useRef<Set<string>>(new Set());
  /** The running top-up, so concurrent callers share one round instead of racing. */
  const inFlightRef = useRef<Promise<TopUpResult> | null>(null);

  const runScan = useCallback((skipCache: boolean): void => {
    setState(INITIAL);
    pendingRef.current = null;
    knownRef.current = new Set();
    setCanTopUp(true);

    // Safety net: the navigator guards this screen behind auth, but if it ever
    // mounts without a publisher (e.g. mid-logout) fail visibly, don't scan.
    if (!publisherId) {
      setState(s => ({ ...s, phase: 'error', error: 'Not signed in' }));
      return;
    }

    void (async (): Promise<void> => {
      try {
        const config = await loadConfig.execute(publisherId);
        setState(s => ({ ...s, photosPerPost: config.photosPerPost, config }));

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
              // Once the post is on screen the grading is a background detail —
              // it must not drag the UI back into the scanning state.
              phase: s.phase === 'done' ? 'done' : 'classifying',
              classified: index,
              total,
              partial: currentBatch,
            }));
          },
          // Enough grades for a real post: show it now and let the rest of the
          // window keep grading behind it.
          onBatchReady(batch, pool) {
            setState(s => ({ ...s, phase: 'done', batch, pool, fromCache: false, error: null }));
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

  // Everything already on screen, kept in sync so a top-up never re-queues a
  // photo the publisher can see. An effect (not a write inside runScan) so the
  // cached path, the scanned path and previous top-ups all feed it.
  useEffect(() => {
    knownRef.current = new Set([...state.batch, ...state.pool].map(c => c.candidate.id));
  }, [state.batch, state.pool]);

  const topUp = useCallback((): Promise<TopUpResult> => {
    const config = state.config;
    if (config == null) return Promise.resolve({ suggestions: [], reason: 'none' });
    // Already running: hand back the same round. Starting a second would double
    // the AI calls for one wave of photos, and the loser of the race used to
    // get an empty result — which reads as "no more photos" to the caller.
    if (inFlightRef.current != null) return inFlightRef.current;

    setToppingUp(true);
    const run = async (): Promise<TopUpResult> => {
      try {
        // Built once per scan, then walked down: the library query is the slow
        // part and the window doesn't move while the screen is open.
        pendingRef.current ??= await suggestPhotos.pendingCandidates(config, knownRef.current);
        const { classified, suggestions, consumed, quotaExhausted } =
          await suggestPhotos.classifyMore(pendingRef.current, config);
        pendingRef.current = pendingRef.current.slice(consumed);

        // Everything classified joins the pool — even the ones not offered now,
        // which become swap material. Appended rather than re-sorted by quality:
        // the pool's head is what the scan already judged best, and a late
        // arrival should not jump it just because the AI scored it highly.
        if (classified.length > 0) setState(s => ({ ...s, pool: [...s.pool, ...classified] }));
        if (quotaExhausted || pendingRef.current.length === 0) setCanTopUp(false);

        return {
          suggestions,
          reason: suggestions.length > 0 ? null : quotaExhausted ? 'quota' : 'none',
        };
      } catch {
        // A failed scan or classify round is not worth retrying on every press;
        // the publisher can rescan, which resets this.
        setCanTopUp(false);
        return { suggestions: [], reason: 'none' };
      } finally {
        setToppingUp(false);
      }
    };

    const started = run();
    inFlightRef.current = started;
    // Cleared here rather than inside `run`, so the slot is released strictly
    // after it was claimed however the body is scheduled — an in-flight marker
    // that outlives its round would wedge every later top-up on a stale result.
    void started.finally(() => {
      if (inFlightRef.current === started) inFlightRef.current = null;
    });
    return started;
  }, [state.config]);

  // Exposed `reload` always does a fresh device scan (ignores cache).
  const reload = useCallback(() => runScan(true), [runScan]);

  return { ...state, reload, topUp, toppingUp, canTopUp };
}
