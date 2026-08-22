import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import { MAX_PHOTOS_PER_POST } from '../../domain/entities/PublisherConfig';
import { isSuggestablePhoto } from '../../domain/services/PhotoSelectionService';
import { emptyRoundNote } from '../../domain/services/reviewCopy';
import type { PlaceSplitSegment } from '../../domain/services/splitSuggestion';
import type { SuggestPhase, TopUpResult } from './useSuggestedPhotos';

/**
 * The grid: which photos are in the post, and how another one is found.
 *
 * `slots` is an ordered list of photo ids, one per grid position. Swapping
 * replaces in place; adding appends. Everything else here exists to answer one
 * question cheaply — "is there another photo worth offering?" — because the
 * honest answer costs an AI call and the dishonest one greyed out the "+" on
 * libraries with ninety photos to spare.
 */

// ---------- background prefetch tuning ----------
//
// The swap chip feels instant because the scan left photos banked. Once those
// run out every press has to wait for the AI, and the fix is to refill quietly
// *before* the publisher asks rather than making them watch it happen.
//
// The cost of getting this wrong is real money: refilling on a timer would have
// every publisher who opens a suggested post classify photos they never look
// at. So it only runs on evidence — see the effect below.

/** Refill once the bank drops to this. Two deep covers a press and a swap. */
const PREFETCH_LOW_WATER = 2;
/** Rounds allowed before it stops volunteering and waits to be asked again. */
const PREFETCH_BUDGET = 2;
/** Quiet period after the last tap, so a flurry of taps doesn't stack rounds. */
const PREFETCH_IDLE_MS = 1200;

export interface ReviewSlots {
  /**
   * The photo ids in the post, in grid order. Handed out as the state array
   * itself, not a derived one: the place-resolution effect keys off it, and a
   * fresh array every render would re-probe the library forever.
   */
  slots: string[];
  /** The photos in the post, in grid order. */
  kept: PhotoClassification[];
  /** Why the last round came back empty, in the publisher's words. */
  topUpNote: string | null;
  /** The photo waiting on a replacement, so its chip can show it working. */
  swappingId: string | null;
  /** The publisher is waiting on the "+" specifically (not a quiet refill). */
  awaitingAdd: boolean;
  /** Whether another photo can still be produced, banked or freshly classified. */
  canOfferMore: boolean;
  /** Fewer photos than the publisher asked for. */
  shortfall: boolean;
  addSlot: () => void;
  swap: (id: string) => void;
  /**
   * Show one place's photos and let the normal post flow handle it.
   *
   * The segment is kept here rather than passed in, so that this hook, the
   * place resolver and the split offer form a chain instead of a cycle: the
   * split offer needs a resolved place, the place needs the slots, and the
   * slots would otherwise need the split.
   */
  showSegment: (segment: PlaceSplitSegment) => void;
}

interface Args {
  phase: SuggestPhase;
  /** The AI-selected batch (or the running partial set while classifying). */
  batch: PhotoClassification[];
  partial: PhotoClassification[];
  pool: PhotoClassification[];
  photosPerPost: number;
  config: PublisherConfig | null;
  topUp: () => Promise<TopUpResult>;
  toppingUp: boolean;
  canTopUp: boolean;
  /** True while a post is uploading — no quiet refills over the top of it. */
  sharing: boolean;
}

export function useReviewSlots({
  phase, batch, partial, pool, photosPerPost, config,
  topUp, toppingUp, canTopUp, sharing,
}: Args): ReviewSlots {
  const [slots, setSlots] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  /** The place being posted, once a split has been accepted. */
  const [splitSegment, setSplitSegment] = useState<PlaceSplitSegment | null>(null);
  const [topUpNote, setTopUpNote] = useState<string | null>(null);
  const [swappingId, setSwappingId] = useState<string | null>(null);
  const [awaitingAdd, setAwaitingAdd] = useState(false);
  const initialisedRef = useRef(false);
  /**
   * Whether the publisher has asked for another photo at all this session.
   * Nothing is prefetched before they do: most people open a suggested post,
   * look at it and send it, and they should never pay for a photo they didn't
   * ask for. A ref, not state — it gates the effect without re-running it.
   */
  const wantsMoreRef = useRef(false);
  /** Background rounds left before it stops volunteering (see PREFETCH_BUDGET). */
  const prefetchBudgetRef = useRef(PREFETCH_BUDGET);

  // Initialise slots from the batch when the scan finishes; reset on a rescan.
  useEffect(() => {
    if (phase === 'loading' || phase === 'scanning') {
      initialisedRef.current = false;
      setSlots([]);
      setExcluded(new Set());
      setSplitSegment(null);
      // A rescan is a fresh review: it must not inherit the last one's appetite
      // for photos, or reloading would start classifying with nothing asked.
      wantsMoreRef.current = false;
      prefetchBudgetRef.current = PREFETCH_BUDGET;
      setTopUpNote(null);
    }
    if (phase === 'done' && !initialisedRef.current && batch.length > 0) {
      initialisedRef.current = true;
      setSlots(batch.slice(0, photosPerPost).map(c => c.candidate.id));
    }
  }, [phase, batch, photosPerPost]);

  const photoById = useMemo(() => {
    const map = new Map<string, PhotoClassification>();
    [...batch, ...pool].forEach(c => map.set(c.candidate.id, c));
    return map;
  }, [batch, pool]);

  // During loading show the running partial set; once done use the slot order.
  const kept = useMemo(() => {
    if (phase !== 'done') return partial;
    return slots
      .map(id => photoById.get(id))
      .filter((c): c is PhotoClassification => c != null);
  }, [phase, slots, photoById, partial]);

  /**
   * Everything already classified that is still worth offering, best first.
   * Filtered by the publisher's own categories: `selectBatch` may fall back to
   * `other` to avoid an empty post, but nothing should volunteer a screenshot
   * as "another photo from those days".
   */
  const offerable = useMemo(() => {
    // Mid-split, a replacement must come from the place being posted —
    // otherwise swapping a Lisbon photo could pull in a Madrid one.
    const all = splitSegment != null ? splitSegment.pool : [...batch, ...pool];
    return config == null ? all : all.filter(c => isSuggestablePhoto(c, config));
  }, [batch, pool, splitSegment, config]);

  /**
   * The photos that could go into a slot right now, with no AI call needed —
   * what the swap chip has always felt instant off, and what the "+" spends
   * before it has to ask for more.
   */
  const ready = useMemo(() => {
    // Only once the scan is done: while classifying, the grid shows the running
    // `partial` batch rather than `slots`, so a swap would change state nothing
    // is rendering from — a button that looks live and isn't.
    if (phase !== 'done') return [];
    const usedIds = new Set(slots);
    return offerable.filter(c => !excluded.has(c.candidate.id) && !usedIds.has(c.candidate.id));
  }, [phase, slots, excluded, offerable]);

  /**
   * Whether another photo can still be produced — either one is already
   * classified and waiting, or the AI can go look at more of the window.
   *
   * Not offered mid-split: a top-up classifies from the whole window, and the
   * leg being posted is one place inside it. Adding a photo from the other city
   * is exactly what splitting was meant to prevent.
   */
  const canOfferMore =
    ready.length > 0 || (canTopUp && splitSegment == null && phase === 'done');

  /**
   * Quietly refill the bank so the next "+" is instant instead of a wait.
   *
   * Every condition here is about not spending the publisher's AI budget on a
   * guess:
   *  - only after they have actually asked for a photo (`wantsMoreRef`), so
   *    opening a post and sending it costs nothing extra;
   *  - only when the bank is nearly out — a deep pool needs no help;
   *  - only while idle: no round already running, no swap mid-flight, not
   *    posting, not mid-split (top-ups don't apply there), not at the cap;
   *  - only after a quiet moment, so a flurry of taps schedules one round;
   *  - and only PREFETCH_BUDGET times in a row. The budget is handed back
   *    whenever a prefetched photo is actually used, so this keeps helping the
   *    publisher who is really building a big post, and quietly stands down for
   *    the one who added a photo and then wandered off.
   */
  useEffect(() => {
    if (!wantsMoreRef.current || prefetchBudgetRef.current <= 0) return;
    if (phase !== 'done' || splitSegment != null) return;
    if (!canTopUp || toppingUp || awaitingAdd || swappingId != null || sharing) return;
    if (kept.length >= MAX_PHOTOS_PER_POST) return;
    if (ready.length > PREFETCH_LOW_WATER) return;

    const timer = setTimeout(() => {
      prefetchBudgetRef.current -= 1;
      void topUp();
    }, PREFETCH_IDLE_MS);
    return () => clearTimeout(timer);
  }, [
    phase, splitSegment, canTopUp, toppingUp, awaitingAdd, swappingId, sharing,
    kept.length, ready.length, topUp,
  ]);

  /**
   * Photos that can fill a slot, in preference order — the ones already banked
   * when there are any, otherwise a fresh round from the AI. An empty list
   * means there genuinely isn't another relevant photo in those days.
   *
   * Returns the whole list rather than one photo so callers can pick against
   * the authoritative `slots` inside a state updater: two taps that land on the
   * same round then take two different photos instead of fighting over one.
   */
  const viableSuggestions = useCallback(
    async (usedIds: Set<string>, excludedIds: Set<string>): Promise<PhotoClassification[]> => {
      const banked = offerable.filter(
        c => !excludedIds.has(c.candidate.id) && !usedIds.has(c.candidate.id),
      );
      if (banked.length > 0) return banked;
      if (!canTopUp || splitSegment != null) return [];
      const { suggestions, reason, attempted } = await topUp();
      setTopUpNote(suggestions.length > 0 ? null : emptyRoundNote(reason, attempted));
      return suggestions;
    },
    [offerable, canTopUp, splitSegment, topUp],
  );

  const addSlot = useCallback((): void => {
    if (kept.length >= MAX_PHOTOS_PER_POST || awaitingAdd) return;
    wantsMoreRef.current = true;
    // Whatever the last round reported is about to be answered again; a stale
    // "nothing found yet" left next to a photo that just appeared reads as a bug.
    setTopUpNote(null);

    // The banked path stays synchronous. Going through the async one for a
    // photo we already hold would flash the spinner for a frame on what has
    // always been an instant action — and that instant feel is the point of
    // banking photos in the first place.
    const banked = ready[0];
    if (banked != null) {
      prefetchBudgetRef.current = PREFETCH_BUDGET;
      setSlots(s =>
        s.length >= MAX_PHOTOS_PER_POST || s.includes(banked.candidate.id)
          ? s
          : [...s, banked.candidate.id],
      );
      return;
    }

    setAwaitingAdd(true);
    void (async (): Promise<void> => {
      try {
        const candidates = await viableSuggestions(new Set(slots), excluded);
        // Picked inside the updater, against the real slots: the round above may
        // have been a network trip, and the grid can have moved under it.
        setSlots(s => {
          if (s.length >= MAX_PHOTOS_PER_POST) return s;
          const used = new Set(s);
          const pick = candidates.find(
            c => !used.has(c.candidate.id) && !excluded.has(c.candidate.id),
          );
          if (pick == null) return s;
          // A photo actually used is proof the prefetching is earning its
          // calls, so it gets its budget back.
          prefetchBudgetRef.current = PREFETCH_BUDGET;
          return [...s, pick.candidate.id];
        });
      } finally {
        setAwaitingAdd(false);
      }
    })();
  }, [kept.length, awaitingAdd, ready, slots, excluded, viableSuggestions]);

  const swap = useCallback((id: string): void => {
    // One swap at a time. An empty answer here means "drop this photo", so a
    // second swap riding on the first one's result could cost the publisher a
    // photo they never rejected.
    if (swappingId != null) return;
    wantsMoreRef.current = true;
    setTopUpNote(null);
    const newExcluded = new Set(excluded);
    newExcluded.add(id);

    // Banked replacement: swap on the spot, exactly as this has always worked.
    // `ready` already excludes everything in a slot, so it never offers back
    // the photo being replaced.
    const banked = ready[0];
    if (banked != null) {
      prefetchBudgetRef.current = PREFETCH_BUDGET;
      setExcluded(newExcluded);
      setSlots(s => s.map(slotId => (slotId === id ? banked.candidate.id : slotId)));
      return;
    }

    setSwappingId(id);
    void (async (): Promise<void> => {
      try {
        // The photo being replaced still occupies its slot, so it is "used" —
        // the replacement must be some other photo.
        const candidates = await viableSuggestions(new Set(slots), newExcluded);
        setExcluded(newExcluded);
        setSlots(s => {
          const used = new Set(s);
          const pick = candidates.find(
            c => !used.has(c.candidate.id) && !newExcluded.has(c.candidate.id),
          );
          // Nothing to swap in: keep the photo. "Other" asks for a different
          // photo, never for one fewer — dropping it deleted a photo the
          // publisher never rejected, and did it most often on exactly the
          // libraries where the round came back empty for reasons that had
          // nothing to do with the photo. `topUpNote` says what happened.
          return pick != null
            ? s.map(slotId => (slotId === id ? pick.candidate.id : slotId))
            : s;
        });
      } finally {
        setSwappingId(null);
      }
    })();
  }, [swappingId, excluded, ready, slots, viableSuggestions]);

  const showSegment = useCallback((segment: PlaceSplitSegment): void => {
    setSplitSegment(segment);
    setSlots(segment.batch.map((c: PhotoClassification) => c.candidate.id));
    setExcluded(new Set());
  }, []);

  return {
    slots,
    kept,
    topUpNote,
    swappingId,
    awaitingAdd,
    canOfferMore,
    shortfall: phase === 'done' && batch.length > 0 && photosPerPost > 0 && batch.length < photosPerPost,
    addSlot,
    swap,
    showSegment,
  };
}
