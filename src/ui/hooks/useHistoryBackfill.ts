import { useCallback, useRef, useState } from 'react';
import {
  backfillHistory,
  loadConfig,
  shareMedia,
  resolvePlaceForCoordinates,
} from '../../composition/container';
import type { BackfillDraft } from '../../application/usecases/BackfillHistoryUseCase';
import type { HistoryWindow, HistoryWindowPlan } from '../../domain/services/historyWindows';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { Coordinate } from '../../domain/interfaces';
import { expoResolveLocalUri } from '../../infrastructure/media/ExpoMediaLibrary';
import { coordinateFor, coordinatesFor } from '../data/photoCoordinates';

export type BackfillPhase = 'setup' | 'scanning' | 'review' | 'publishing' | 'done' | 'error';

/** A reconstructed posting as the review timeline shows it — draft + user edits. */
export interface ReviewablePosting {
  /** Stable key: the window's start, which is unique within a plan. */
  id: string;
  draft: BackfillDraft;
  /** Photo ids currently in the post, in grid order. */
  slots: string[];
  /** Resolved or publisher-edited place. */
  place: string;
  placeLoading: boolean;
  /**
   * Whether this window's photos carry GPS. False is common in a backfill —
   * older trips, imported photos, GPS-stripped exports — and it's exactly when
   * the publisher has to pick a place for the posting to reach the globe.
   */
  hasGps: boolean;
  /**
   * The posting's point on the map: photo GPS when there is any, otherwise the
   * coordinate that came with the place the publisher picked (issue #78). A
   * label alone cannot be plotted.
   */
  coordinate?: Coordinate;
  /** Publisher unchecked it — scanned but not published. */
  dropped: boolean;
  /**
   * Where this one posting has got to. Per-posting rather than one flag for
   * the whole run, so a stretch the publisher is happy with can go out while
   * the rest are still being reconstructed.
   */
  status: 'draft' | 'publishing' | 'published' | 'failed';
  /** Why it failed, shown on the card rather than swallowed. */
  error?: string;
}

/** A posting that could not be written, and why — shown, never swallowed. */
export interface PublishFailure {
  /** Human-readable window, e.g. "1 Jun – 7 Jun". */
  when: string;
  reason: string;
}

/** What a publish run actually managed to write. */
export interface PublishOutcome {
  published: number;
  failed: number;
  failures: PublishFailure[];
}

interface State {
  phase: BackfillPhase;
  plan: HistoryWindowPlan | null;
  postings: ReviewablePosting[];
  /** 1-based index of the window being scanned. */
  scanningWindow: number;
  totalWindows: number;
  /** Photos classified so far in the current stretch, and how many there are. */
  scanClassified: number;
  scanOf: number;
  /** The running pick for the current stretch — shown live, so a slow scan
   *  still visibly produces something rather than sitting on a spinner. */
  scanBatch: PhotoClassification[];
  /** True when the day's AI budget cut the scan short. */
  quotaExhausted: boolean;
  /** Publisher has paused the scan; it stops at the next window boundary. */
  paused: boolean;
  /** How many postings have been written during publishing. */
  published: number;
  /** Postings that failed to publish — reported rather than silently dropped. */
  failedCount: number;
  error: string | null;
}

const INITIAL: State = {
  phase: 'setup',
  plan: null,
  postings: [],
  scanningWindow: 0,
  totalWindows: 0,
  scanClassified: 0,
  scanOf: 0,
  scanBatch: [],
  quotaExhausted: false,
  paused: false,
  published: 0,
  failedCount: 0,
  error: null,
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "1 Jun – 7 Jun" for a window. The end is exclusive, so the label steps back a
 * millisecond — otherwise a week reads as spanning eight days.
 */
export function describeWindow(start: Date, end: Date): string {
  const fmt = (d: Date): string => `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
  return `${fmt(start)} – ${fmt(new Date(end.getTime() - 1))}`;
}

/** A finished draft as the review timeline holds it. */
function toReviewable(draft: BackfillDraft): ReviewablePosting {
  return {
    id: draft.window.start.toISOString(),
    draft,
    slots: draft.batch.map(c => c.candidate.id),
    place: '',
    placeLoading: true,
    hasGps: false, // corrected once the GPS probe has run
    dropped: false,
    status: 'draft',
  };
}

/** Every classified photo of a draft, batch and pool alike, keyed by id. */
function indexPhotos(draft: BackfillDraft): Map<string, PhotoClassification> {
  const map = new Map<string, PhotoClassification>();
  [...draft.batch, ...draft.pool].forEach(c => map.set(c.candidate.id, c));
  return map;
}

/**
 * Drives the history backfill (issue #81): preview the window plan, scan each
 * window, let the publisher edit the reconstructed timeline, then publish it
 * back-dated and silent.
 *
 * The "silent" part is enforced at the use-case boundary (`notify: false`), not
 * here — a UI-level omission would be one refactor away from spamming every
 * follower with a decade of history.
 */
export function useHistoryBackfill(publisherId: string): State & {
  run: (startDate: Date, intervalDays: number, windows?: HistoryWindow[]) => void;
  toggleDropped: (id: string) => void;
  setPlace: (id: string, place: string, coordinate?: Coordinate) => void;
  swapPhoto: (id: string, photoId: string) => void;
  publish: () => Promise<PublishOutcome>;
  publishOne: (id: string) => Promise<void>;
  togglePause: () => void;
  reset: () => void;
} {
  const [state, setState] = useState<State>(INITIAL);
  // Places the publisher typed themselves — never overwritten by resolution.
  const editedPlaces = useRef<Set<string>>(new Set());
  // The pause gate. Held in a ref because the running scan closes over it once
  // and must see every later toggle, which a state value would not give it.
  const pause = useRef<{ paused: boolean; waiting: (() => void)[] }>({ paused: false, waiting: [] });

  const togglePause = useCallback((): void => {
    const gate = pause.current;
    gate.paused = !gate.paused;
    if (!gate.paused) {
      // Release whatever window was held at the boundary.
      gate.waiting.forEach(resume => resume());
      gate.waiting = [];
    }
    setState(s => ({ ...s, paused: gate.paused }));
  }, []);

  const run = useCallback((startDate: Date, intervalDays: number, windows?: HistoryWindow[]): void => {
    setState({ ...INITIAL, phase: 'scanning' });
    editedPlaces.current = new Set();
    pause.current = { paused: false, waiting: [] };

    if (!publisherId) {
      setState(s => ({ ...s, phase: 'error', error: 'Not signed in' }));
      return;
    }

    void (async (): Promise<void> => {
      try {
        const config = await loadConfig.execute(publisherId);
        const result = await backfillHistory.execute(
          {
            config,
            startDate,
            endDate: new Date(),
            intervalDays,
            // Only the uncovered stretches when the caller knows them, so a
            // partly-posted trip doesn't spend the day's AI budget rescanning
            // windows that already have a posting.
            ...(windows != null ? { windows } : {}),
            beforeWindow: () =>
              pause.current.paused
                ? new Promise<void>(resolve => pause.current.waiting.push(resolve))
                : Promise.resolve(),
          },
          {
            onPlanned: plan => {
              setState(s => ({ ...s, plan, totalWindows: plan.windows.length }));
            },
            onWindowStart: index => {
              // Reset the inner counters so the new stretch doesn't inherit
              // the previous one's progress bar.
              setState(s => ({
                ...s, scanningWindow: index, scanClassified: 0, scanOf: 0, scanBatch: [],
              }));
            },
            onWindowProgress: (_index, _total, p) => {
              setState(s => ({
                ...s, scanClassified: p.classified, scanOf: p.of, scanBatch: p.batch,
              }));
            },
            onWindowDone: (_index, _total, draft) => {
              if (draft == null) return;
              // Land the finished stretch in `postings` straight away rather
              // than collecting drafts and rebuilding at the end: the review
              // list IS the scan list, so a photo swapped while the scan is
              // still running is not thrown away when it completes.
              const posting = toReviewable(draft);
              setState(s => ({ ...s, postings: [...s.postings, posting] }));
              // Its place resolves in the background, per stretch, so review is
              // instant instead of waiting on a burst of geocodes at the end.
              void resolvePlaceFor(posting).then(({ place, coordinate }) => {
                setState(s => ({
                  ...s,
                  postings: s.postings.map(p => {
                    if (p.id !== posting.id) return p;
                    const base = {
                      ...p,
                      placeLoading: false,
                      hasGps: coordinate != null,
                      ...(coordinate != null ? { coordinate } : {}),
                    };
                    return editedPlaces.current.has(p.id) ? base : { ...base, place: place ?? '' };
                  }),
                }));
              }).catch(() => undefined);
            },
          },
        );


        setState(s => ({
          ...s,
          phase: 'review',
          plan: result.plan,
          quotaExhausted: result.quotaExhausted,
          error: null,
        }));

      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Could not rebuild your history';
        setState(s => ({ ...s, phase: 'error', error: message }));
      }
    })();
  }, [publisherId]);

  const toggleDropped = useCallback((id: string): void => {
    setState(s => ({
      ...s,
      postings: s.postings.map(p => (p.id === id ? { ...p, dropped: !p.dropped } : p)),
    }));
  }, []);

  const setPlace = useCallback((id: string, place: string, coordinate?: Coordinate): void => {
    editedPlaces.current.add(id);
    setState(s => ({
      ...s,
      postings: s.postings.map(p =>
        // A picked suggestion brings its own coordinate; plain typing leaves
        // whatever fix the photos already gave us untouched.
        p.id === id ? { ...p, place, ...(coordinate != null ? { coordinate } : {}) } : p,
      ),
    }));
  }, []);

  /** Replaces one photo with the next unused one from that window's pool. */
  const swapPhoto = useCallback((id: string, photoId: string): void => {
    setState(s => ({
      ...s,
      postings: s.postings.map(p => {
        if (p.id !== id) return p;
        const used = new Set(p.slots);
        const replacement = [...p.draft.batch, ...p.draft.pool].find(
          c => !used.has(c.candidate.id),
        );
        // No spare photo in this window — drop the slot rather than leaving a
        // photo the publisher explicitly rejected.
        return {
          ...p,
          slots: replacement
            ? p.slots.map(s2 => (s2 === photoId ? replacement.candidate.id : s2))
            : p.slots.filter(s2 => s2 !== photoId),
        };
      }),
    }));
  }, []);

  /**
   * Publish one stretch now, leaving the rest alone. The scan carries on
   * underneath: waiting for a twenty-stretch reconstruction to finish before
   * anything can go out is the whole complaint this answers.
   */
  const publishOne = useCallback(async (id: string): Promise<void> => {
    const posting = state.postings.find(p => p.id === id);
    if (posting == null || posting.status === 'publishing' || posting.status === 'published') return;

    const mark = (status: ReviewablePosting['status'], error?: string): void =>
      setState(s => ({
        ...s,
        postings: s.postings.map(p =>
          p.id === id ? { ...p, status, ...(error != null ? { error } : {}) } : p,
        ),
      }));

    mark('publishing');
    try {
      await publishPosting(publisherId, posting);
      mark('published');
    } catch (e: unknown) {
      mark('failed', e instanceof Error ? e.message : 'Could not publish this post');
    }
  }, [publisherId, state.postings]);

  /**
   * Publishes every kept posting, back-dated and silent. Returns the tally
   * directly — a caller reading it off state right after would still see the
   * pre-publish render.
   */
  const publish = useCallback(async (): Promise<PublishOutcome> => {
    // Anything already sent individually is skipped — publishing it twice
    // would put the same stretch in the feed under two postings.
    const kept = state.postings.filter(
      p => !p.dropped && p.slots.length > 0 && p.status !== 'published' && p.status !== 'publishing',
    );
    setState(s => ({ ...s, phase: 'publishing', published: 0 }));

    let count = 0;
    let failed = 0;
    // Sequential: each posting uploads several full-resolution photos, and
    // publishing a whole timeline at once is exactly the unbounded-upload
    // pattern that got the app watchdog-killed before (see SyncCandidatePhotos).
    const failures: PublishFailure[] = [];
    for (const posting of kept) {
      try {
        await publishPosting(publisherId, posting);
        count++;
        setState(s => ({
          ...s,
          published: count,
          postings: s.postings.map(p => (p.id === posting.id ? { ...p, status: 'published' } : p)),
        }));
      } catch (e: unknown) {
        // One posting failing — an iCloud photo that won't download, a dropped
        // upload — must not discard the rest of a twenty-post timeline. The
        // publisher can re-run the backfill; already-published photos are
        // excluded from the next suggestion pass.
        failed++;
        failures.push({
          when: describeWindow(posting.draft.window.start, posting.draft.window.end),
          reason: e instanceof Error ? e.message : 'unknown error',
        });
      }
    }

    if (count === 0 && failed > 0) {
      // Lead with the actual reason: "no posts went through" alone leaves the
      // publisher with nothing to act on.
      const message = `Could not publish your history — ${failures[0]?.reason ?? 'no posts went through'}.`;
      setState(s => ({ ...s, phase: 'error', error: message, failedCount: failed }));
      throw new Error(message);
    }

    setState(s => ({ ...s, phase: 'done', published: count, failedCount: failed }));
    return { published: count, failed, failures };
  }, [publisherId, state.postings]);

  const reset = useCallback((): void => setState(INITIAL), []);

  return { ...state, run, toggleDropped, setPlace, swapPhoto, publish, publishOne, togglePause, reset };
}

/**
 * "City, Country" for a posting, plus the point it will sit on. Returns no
 * coordinate when none of the window's photos carry GPS — the review UI then
 * asks the publisher to search for the place, which is the only way that
 * posting reaches the globe.
 */
async function resolvePlaceFor(
  posting: ReviewablePosting,
): Promise<{ place: string | null; coordinate?: Coordinate }> {
  const photos = indexPhotos(posting.draft);
  const ids = posting.slots.filter(id => photos.get(id)?.candidate.uri.startsWith('http') !== true);
  const coordinates = await coordinatesFor(ids);
  const first = coordinates[0];
  if (first == null) return { place: null };
  try {
    return { place: await resolvePlaceForCoordinates(coordinates), coordinate: first };
  } catch {
    // Naming the place is a nicety — never block reconstructing the trip. The
    // fix still stands on its own, so the posting can be plotted regardless.
    return { place: null, coordinate: first };
  }
}

/**
 * Writes one reconstructed posting. Dated to the newest photo in it — the
 * photo's own timestamp is truer than the window boundary, which is an artefact
 * of the chosen cadence.
 */
async function publishPosting(publisherId: string, posting: ReviewablePosting): Promise<void> {
  const photos = indexPhotos(posting.draft);
  const chosen = posting.slots
    .map(id => photos.get(id))
    .filter((c): c is PhotoClassification => c != null);
  if (chosen.length === 0) return;

  // Resolving a photo can fail on its own — an iCloud original that won't
  // download over a bad connection is the common one. Skip just that photo and
  // publish the rest of the stretch; losing the whole posting because one shot
  // of nine wouldn't come down is a far worse trade.
  const skipped: string[] = [];
  const resolved = await Promise.all(
    chosen.map(async c => {
      const isRemote = c.candidate.uri.startsWith('http');
      try {
        const localUri = isRemote ? c.candidate.uri : await expoResolveLocalUri(c.candidate);
        // A missing GPS fix is normal, never a reason to drop the photo —
        // coordinateFor already swallows its own failures and returns undefined.
        const coordinate = isRemote ? undefined : await coordinateFor(c.candidate.id);
        return {
          mediaId: c.candidate.id,
          localUri,
          filename: c.candidate.uri.split('/').pop() ?? `${c.candidate.id}.jpg`,
          ...(coordinate != null ? { coordinate } : {}),
        };
      } catch (e: unknown) {
        skipped.push(e instanceof Error ? e.message : 'could not be read');
        return null;
      }
    }),
  );
  const items = resolved.filter((i): i is NonNullable<typeof i> => i != null);

  if (items.length === 0) {
    // Every photo unreadable — the caller counts this posting as failed and
    // shows the reason rather than reporting a silent success of nothing.
    throw new Error(skipped[0] ?? 'no photos could be read');
  }

  const newest = chosen.reduce(
    (latest, c) => (c.candidate.createdAt > latest ? c.candidate.createdAt : latest),
    chosen[0]?.candidate.createdAt ?? posting.draft.window.end,
  );

  await shareMedia.share({
    ownerId: publisherId,
    items,
    // Fallback point for a window whose photos carry no GPS — without it the
    // posting would have a place name but nothing to plot on the globe.
    ...(posting.coordinate != null ? { coordinate: posting.coordinate } : {}),
    createdAt: newest,
    // History is feed-only. Ten reconstructed trips must never become ten
    // WhatsApp blasts at every follower.
    notify: false,
    backfilled: true,
    location: posting.place.trim() === '' ? null : posting.place.trim(),
  });
}
