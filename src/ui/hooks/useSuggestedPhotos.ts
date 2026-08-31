import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadConfig,
  suggestPhotos,
  SuggestionCache,
  cachedPhotoToClassification,
  classificationToCachedPhoto,
} from '../../composition/container';
import type { SuggestStats } from '../../application/usecases/SuggestPhotosUseCase';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';

// Re-exported for the screens that render these numbers: use cases are off
// limits above this layer (the hook is the seam), and the stats are part of
// what this hook returns.
export type { SuggestStats };
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { SuggestionPhase } from '../../domain/services/suggestionProgress';

/**
 * Mirrors `SuggestionPhase` in the domain, which is where the step model that
 * reads it lives. `deduping` is the beat between the library scan and the first
 * grade — collapsing bursts, loading remembered grades, resolving the face to
 * match. It was previously folded into `scanning`, which is why the app looked
 * like it went straight from finding photos to having a post.
 */
export type SuggestPhase = SuggestionPhase;

/**
 * Why a top-up came back empty. The distinction matters: only `exhausted`,
 * `quota` and `failed` mean "stop asking" — `capped` means the round hit its
 * wave limit with the window still unfinished, and reporting that as "nothing
 * left" is what greyed out the "+" on a library that had ninety photos to
 * spare. `failed` is the classifier itself erroring, which must never be
 * reported as a fact about the publisher's photos.
 *
 * `busy` is the AI provider throttling us. It looks like `quota` from here —
 * the round stops early either way — but it clears in seconds rather than at
 * midnight, so it keeps the "+" alive and asks the publisher to try again
 * shortly (issue #141).
 */
export type TopUpReason = 'exhausted' | 'quota' | 'busy' | 'capped' | 'failed';

/** Outcome of one "give me another photo" request. */
export interface TopUpResult {
  /** Newly classified photos worth suggesting — empty when the AI found none. */
  suggestions: PhotoClassification[];
  /** Why it came back empty, for the caller's copy. Null when it didn't. */
  reason: TopUpReason | null;
  /** Photos this round looked at — what "kept looking" cost, for the copy. */
  attempted: number;
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
   * The classifier is still working. NOT the same as `phase !== 'done'`: the
   * post becomes previewable at twice photos-per-post and `phase` turns `done`
   * there, while the rest of the window keeps grading behind it. Anything that
   * reports grading progress has to read this instead, or it will call the
   * stage finished a fifth of the way through (see `suggestionProgress`).
   */
  grading: boolean;
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
  /** When a cached batch was computed, so the screen can say how old it is. */
  cachedAt: number | null;
  /** What the scan actually managed — null for a cached batch, which ran none. */
  stats: SuggestStats | null;
  /**
   * The caught failure, kept whole so the screen can tell an offline phone
   * from a broken classifier (issue #145). The one case worth rewording — the
   * classifier being unreachable — is wrapped in an Error whose message is
   * already the sentence to show.
   */
  error: unknown;
}

const INITIAL: State = {
  phase: 'loading',
  found: 0,
  unique: 0,
  classified: 0,
  total: 0,
  grading: false,
  partial: [],
  batch: [],
  pool: [],
  photosPerPost: 0,
  config: null,
  fromCache: false,
  cachedAt: null,
  stats: null,
  error: null,
};

/**
 * How old a cached batch may be before the screen rescans instead of showing it.
 *
 * The cache exists so the reminder's batch opens instantly, not so a week-old
 * selection can be served as "your suggested post" — which is exactly what
 * happened: a publisher who opened the preview saw photos from three days ago,
 * none from today, and no obvious way to say "look again". The store's own
 * 32-day TTL is about garbage collection; this is about relevance.
 *
 * It is a ceiling, not the whole test. Any photo taken since the batch was
 * computed supersedes it outright however recent it is — see the library check
 * in `runScan`. Age was the *only* test for a long time, which is why a batch
 * could keep replaying over a morning's worth of new photos.
 */
const STALE_CACHE_MS = 6 * 60 * 60 * 1000;

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
      setState(s => ({ ...s, phase: 'error', error: new Error('Not signed in') }));
      return;
    }

    void (async (): Promise<void> => {
      try {
        const config = await loadConfig.execute(publisherId);
        setState(s => ({ ...s, photosPerPost: config.photosPerPost, config }));

        // Use the server-pre-computed batch when available (skips the full scan).
        // Only while it still describes the library, though: a stale one is worse
        // than no cache, because it silently hides everything shot since.
        if (!skipCache) {
          const cached = await SuggestionCache.load(publisherId);
          // Age alone is not staleness. A batch computed an hour ago is worthless
          // if the publisher has been shooting since — those photos are the whole
          // reason they opened the screen. The library check is metadata-only, so
          // it costs a query rather than a scan.
          const supersededByNewPhotos =
            cached != null &&
            (await suggestPhotos.hasPhotosSince(new Date(cached.cachedAt)).catch(() => false));
          if (
            cached != null &&
            !supersededByNewPhotos &&
            Date.now() - cached.cachedAt < STALE_CACHE_MS
          ) {
            const batch = cached.batch.map(cachedPhotoToClassification);
            const pool = cached.pool.map(cachedPhotoToClassification);
            setState(s => ({
              ...s,
              phase: 'done',
              batch,
              pool,
              fromCache: true,
              cachedAt: cached.cachedAt,
              error: null,
            }));
            return;
          }
        }

        // No cache — transition to scanning UI now and run a full device scan.
        setState(s => ({ ...s, phase: 'scanning' }));
        await SuggestionCache.clear(publisherId);

        const { batch, pool, stats } = await suggestPhotos.execute(config, {
          onScanning() {
            setState(s => ({ ...s, phase: 'scanning' }));
          },
          onScanned(found, unique) {
            // The scan is in; what follows is burst grouping, the remembered
            // grades and the face to match — a real beat, and previously an
            // invisible one that made the run look like it jumped from
            // "finding photos" to "here's your post".
            setState(s => ({ ...s, found, unique, phase: s.phase === 'done' ? 'done' : 'deduping' }));
          },
          onClassifying(index, total, currentBatch) {
            setState(s => ({
              ...s,
              // Once the post is on screen the grading is a background detail —
              // it must not drag the UI back into the scanning state.
              phase: s.phase === 'done' ? 'done' : 'classifying',
              classified: index,
              total,
              // True until the classifier stops, which is well after the post
              // appears. The step bar reads this rather than `phase`.
              grading: true,
              partial: currentBatch,
            }));
          },
          // Enough grades for a real post: show it now and let the rest of the
          // window keep grading behind it.
          onBatchReady(batch, pool) {
            setState(s => ({ ...s, phase: 'done', batch, pool, fromCache: false, error: null }));
          },
        });

        // `classified`/`total` are deliberately NOT reset here: they are the
        // finished tally ("72 of 72"), and blanking them left the grading step
        // with nothing to show for the minutes it just spent.
        setState(s => ({ ...s, phase: 'done', grading: false, partial: [], batch, pool, fromCache: false, cachedAt: null, stats, error: null }));

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
        // A classifier failure is the one error worth translating: its message
        // is an HTTP status the publisher can do nothing with, and the scan
        // aborting is the *point* — no batch is better than a batch built from
        // invented grades. Matched by name rather than by class so the hook
        // doesn't have to reach into the infrastructure layer.
        const failedToClassify = e instanceof Error && e.name === 'ClassificationFailedError';
        if (failedToClassify) console.warn('suggest scan aborted:', e);
        const error = failedToClassify
          ? new Error(
              'Could not reach the photo AI, so nothing was analysed. Your photos are untouched — try again in a moment.',
            )
          : e;
        setState(s => ({ ...s, phase: 'error', grading: false, error }));
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
    if (config == null) return Promise.resolve({ suggestions: [], reason: 'exhausted', attempted: 0 });
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
        const { classified, suggestions, consumed, quotaExhausted, rateLimited } =
          await suggestPhotos.classifyMore(pendingRef.current, config);
        pendingRef.current = pendingRef.current.slice(consumed);

        // Everything classified joins the pool — even the ones not offered now,
        // which become swap material. Appended rather than re-sorted by quality:
        // the pool's head is what the scan already judged best, and a late
        // arrival should not jump it just because the AI scored it highly.
        if (classified.length > 0) setState(s => ({ ...s, pool: [...s.pool, ...classified] }));
        // Only a real dead end closes the door. A round that stopped at its wave
        // limit leaves the queue standing, and saying "no more photos" there is
        // a claim about the library that the round never established.
        const exhausted = pendingRef.current.length === 0;
        // Throttling deliberately does NOT close the door: the queue still has
        // photos and the wall lifts in seconds, so greying out the "+" would
        // strand the publisher for the rest of the session over a pause.
        if (quotaExhausted || exhausted) setCanTopUp(false);

        return {
          suggestions,
          reason:
            suggestions.length > 0
              ? null
              : quotaExhausted
                ? 'quota'
                : rateLimited
                  ? 'busy'
                  : exhausted
                    ? 'exhausted'
                    : 'capped',
          attempted: consumed,
        };
      } catch {
        // A failed scan or classify round is not worth retrying on every press;
        // the publisher can rescan, which resets this. Reported as `failed`,
        // never `exhausted`: the round established nothing about the library,
        // and "that's every photo from those days" would be a claim this code
        // has no basis for making.
        setCanTopUp(false);
        return { suggestions: [], reason: 'failed', attempted: 0 };
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
