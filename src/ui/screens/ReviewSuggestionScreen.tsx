import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RootNavigationProp } from '../navigation/types';
import { useSuggestedPhotos } from '../hooks/useSuggestedPhotos';
import { useShareMedia } from '../hooks/useShareMedia';
import { useKeyboardBottomPadding } from '../hooks/useKeyboardBottomPadding';
import { usePublisherId } from '../context/AuthContext';
import { SuggestionCache } from '../../infrastructure/cache/SuggestionCache';
import { expoResolveLocalUri } from '../../infrastructure/media/ExpoMediaLibrary';
import { resolvePlaceForCoordinates, loadConfig } from '../../composition/container';
import * as MediaLibrary from 'expo-media-library';
import type { Coordinate } from '../../domain/interfaces';
import { validCoordinate } from '../../domain/services/coordinate';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import { MAX_PHOTOS_PER_POST } from '../../domain/entities/PublisherConfig';
import { isSuggestablePhoto } from '../../domain/services/PhotoSelectionService';
import { mapInBatches, PHOTO_METADATA_BATCH_SIZE } from '../../application/services/mapInBatches';
import { suggestPlaceSplit } from '../../domain/services/splitSuggestion';
import type { PlaceSplitSegment } from '../../domain/services/splitSuggestion';
import { PlaceField } from '../components/PlaceField';
import { SuggestionPhotoCard } from '../components/SuggestionPhotoCard';
import { colors, radius, spacing, typography } from '../theme/theme';


// ---------- step indicator ----------

const STEPS = ['Scanning', 'Classifying', 'Done'] as const;

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

function stepIndex(phase: string): number {
  if (phase === 'scanning') return 0;
  if (phase === 'classifying') return 1;
  return 2;
}

function StepBar({ phase, classified, total }: {
  phase: string; classified: number; total: number;
}): React.JSX.Element {
  const current = stepIndex(phase);
  const pct = total > 0 ? Math.round((classified / total) * 100) : 0;

  return (
    <View>
      <View style={stepStyles.container}>
        {STEPS.map((label, i) => {
          const active = i === current;
          const done = i < current || phase === 'done';
          return (
            <React.Fragment key={label}>
              {i > 0 && <View style={[stepStyles.line, done && stepStyles.lineDone]} />}
              <View style={[stepStyles.dot, done && stepStyles.dotDone, active && stepStyles.dotActive]}>
                {done && !active ? (
                  <Ionicons name="checkmark" size={10} color={colors.onAccent} />
                ) : (
                  <Text style={stepStyles.dotText}>{i + 1}</Text>
                )}
              </View>
              <Text style={[stepStyles.label, (active || done) && stepStyles.labelActive]}>
                {label}
              </Text>
            </React.Fragment>
          );
        })}
      </View>
      {phase === 'classifying' && total > 0 && (
        <View style={stepStyles.barRow}>
          <View style={stepStyles.track}>
            <View style={[stepStyles.fill, { width: `${pct}%` }]} />
          </View>
          <Text style={stepStyles.pct}>{pct}%</Text>
        </View>
      )}
    </View>
  );
}


// ---------- inner content (usable inline in the sheet OR as a full screen) ----------

interface ContentProps {
  onBack: () => void;
  bottomInset?: number;
}

export function ReviewSuggestionContent({ onBack, bottomInset = 0 }: ContentProps): React.JSX.Element {
  const publisherId = usePublisherId();
  const {
    phase, found, unique, classified, total, partial, batch, pool, photosPerPost, config,
    fromCache, error, reload, topUp, toppingUp, canTopUp,
  } = useSuggestedPhotos(publisherId);
  const { share, loading: sharing, error: shareError, progress: shareProgress } = useShareMedia();
  // Keeps the footer's place input above the keyboard (this screen renders in
  // sheets/modals where KeyboardAvoidingView mis-measures — see the hook doc).
  const keyboardPadding = useKeyboardBottomPadding();
  // `slots` is the ordered list of photo IDs shown in the grid — one entry per grid position.
  // Initialised from `batch` when classification finishes; swapping replaces in-place.
  const [slots, setSlots] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(false);
  const slotsInitRef = useRef(false);
  // Posting place — auto-resolved from the batch's GPS, editable by the user.
  const [place, setPlace] = useState('');
  const [placeLoading, setPlaceLoading] = useState(false);
  const placeEditedRef = useRef(false);
  // The coordinate a picked suggestion carries, for batches with no photo GPS.
  const [pickedCoordinate, setPickedCoordinate] = useState<Coordinate | undefined>(undefined);
  // Any GPS at all in the batch — decides whether a picked place is required.
  const [gpsCoordinate, setGpsCoordinate] = useState<Coordinate | undefined>(undefined);
  // A posting has to land somewhere real on the map: a GPS fix from the batch
  // (or the surrounding scan), or a place the publisher picked. A typed label
  // alone cannot be plotted without guessing at a city centre.
  const canPost = gpsCoordinate != null || pickedCoordinate != null;
  // Which GPS source produced the place — surfaced under the
  // field so an empty suggestion is explained, never silent (issue #63).
  const [placeSource, setPlaceSource] = useState<'photos' | 'scan' | 'none' | null>(null);
  // GPS per asset id (undefined = probed, no GPS), fetched once for the
  // place preview and reused on post.
  const coordsRef = useRef<Map<string, Coordinate | undefined>>(new Map());
  /**
   * Split-by-place. `offered` is only a suggestion — segmentation is a
   * heuristic over GPS, so a wrong guess costs one dismissal rather than an
   * unwanted post. `split` is set once the publisher accepts, and walks the
   * places one post at a time.
   */
  const [offered, setOffered] = useState<PlaceSplitSegment[] | null>(null);
  const [splitDismissed, setSplitDismissed] = useState(false);
  const [split, setSplit] = useState<{ segments: PlaceSplitSegment[]; index: number } | null>(null);
  // Set when a top-up came back empty, so the "+" can say why rather than just
  // going grey. Cleared as soon as another one succeeds.
  const [topUpNote, setTopUpNote] = useState<string | null>(null);
  // Which photo is waiting on a replacement, so its chip can show it is working.
  const [swappingId, setSwappingId] = useState<string | null>(null);
  // The publisher is waiting on the "+" specifically. Distinct from the hook's
  // `toppingUp`, which is also true during a background refill — that one must
  // stay invisible, or the quiet prefetch would announce itself as a spinner.
  const [awaitingAdd, setAwaitingAdd] = useState(false);
  /**
   * Whether the publisher has asked for another photo at all this session.
   * Nothing is prefetched before they do: most people open a suggested post,
   * look at it and send it, and they should never pay for a photo they didn't
   * ask for. A ref, not state — it gates the effect without re-running it.
   */
  const wantsMoreRef = useRef(false);
  /** Background rounds left before it stops volunteering (see PREFETCH_BUDGET). */
  const prefetchBudgetRef = useRef(PREFETCH_BUDGET);

  // Initialise slots from batch when done; reset if the user re-scans.
  useEffect(() => {
    if (phase === 'loading' || phase === 'scanning') {
      slotsInitRef.current = false;
      setSlots([]);
      setExcluded(new Set());
      placeEditedRef.current = false;
      coordsRef.current.clear();
      setPlace('');
      setPlaceSource(null);
      // A rescan is a fresh review: it must not inherit the last one's appetite
      // for photos, or reloading would start classifying with nothing asked.
      wantsMoreRef.current = false;
      prefetchBudgetRef.current = PREFETCH_BUDGET;
      setTopUpNote(null);
    }
    if (phase === 'done' && !slotsInitRef.current && batch.length > 0) {
      slotsInitRef.current = true;
      setSlots(batch.slice(0, photosPerPost).map(c => c.candidate.id));
    }
  }, [phase, batch, photosPerPost]);

  // Resolve the batch's place whenever the selection changes, so the user
  // sees (and can edit) the place before posting. Their manual edit always
  // wins over re-resolution. Resolution order:
  //   1. GPS of the selected photos → reverse geocode.
  //   2. GPS of any other photo from the same scan (batch + pool) — same
  //      lookback window, almost always the same trip.
  useEffect(() => {
    if (phase !== 'done' || slots.length === 0) return;
    // Object property (not a local) so eslint doesn't flow-narrow it — the
    // cleanup closure flips it after this effect body has been analysed.
    const run = { cancelled: false };
    void (async (): Promise<void> => {
      setPlaceLoading(true);
      try {
        // All lookups in parallel — sequential awaits made the first
        // resolution take many seconds on iCloud-backed libraries.
        const probeGps = (ids: string[]): Promise<void[]> =>
          Promise.all(
            ids.map(async id => {
              if (coordsRef.current.has(id)) return;
              try {
                const info = await MediaLibrary.getAssetInfoAsync(id);
                // Cache misses too (undefined) so we don't refetch per selection change.
                coordsRef.current.set(
                  id,
                  info.location != null
                    ? validCoordinate(info.location.latitude, info.location.longitude) ?? undefined
                    : undefined,
                );
              } catch {
                coordsRef.current.set(id, undefined);
              }
            }),
          );
        const gpsOf = (ids: string[]): Coordinate[] =>
          ids.map(id => coordsRef.current.get(id)).filter((c): c is Coordinate => c != null);

        // Checked via a function call so lint doesn't flow-narrow across awaits.
        const isStale = (): boolean => run.cancelled || placeEditedRef.current;

        await probeGps(slots);
        if (isStale()) return;
        let coordinates = gpsOf(slots);
        let source: 'photos' | 'scan' = 'photos';
        if (__DEV__) console.log(`[place] GPS on ${coordinates.length}/${slots.length} selected photos`);

        // The selection has no GPS — borrow it from the rest of the scan.
        if (coordinates.length === 0) {
          const slotIds = new Set(slots);
          const restIds = [...batch, ...pool]
            .map(c => c.candidate.id)
            .filter(id => !slotIds.has(id));
          await probeGps(restIds);
          if (isStale()) return;
          coordinates = gpsOf(restIds);
          source = 'scan';
        }

        // Keep the coordinate, not just the name it resolved to. When the
        // selection had no GPS this is borrowed from the rest of the scan —
        // the same trip, minutes apart — which is a far better pin than
        // geocoding the label back to a city centre later.
        if (!run.cancelled) setGpsCoordinate(coordinates[0]);
        const resolved = coordinates.length > 0 ? await resolvePlaceForCoordinates(coordinates) : null;
        if (isStale()) return;

        if (!isStale()) {
          if (__DEV__) console.log(`[place] resolved via ${resolved != null ? source : 'nothing'}: ${JSON.stringify(resolved)}`);
          setPlace(resolved ?? '');
          setPlaceSource(resolved != null ? source : 'none');
        }
      } finally {
        if (!run.cancelled) setPlaceLoading(false);
      }
    })();
    return () => { run.cancelled = true; };
  }, [phase, slots, batch, pool]);

  // Look for separate stays only once the place probe has run — before that
  // coordsRef is empty and every photo looks un-located, so no split could be
  // found however far apart the photos actually were.
  useEffect(() => {
    if (phase !== 'done' || placeLoading || split != null || splitDismissed) return;
    // Object property, not a local: eslint flow-narrows a `let` here and the
    // cleanup closure flips it only after this body has been analysed (same
    // reason as the place-resolution effect above).
    const run = { cancelled: false };
    // Read through a call so lint doesn't flow-narrow it across the awaits,
    // exactly as the place-resolution effect above does.
    const isStale = (): boolean => run.cancelled;
    void (async (): Promise<void> => {
      const config = await loadConfig.execute(publisherId).catch(() => null);
      if (config == null || isStale()) return;
      const segments = suggestPlaceSplit(
        [...batch, ...pool],
        (id: string) => coordsRef.current.get(id),
        config,
      );
      if (!isStale()) setOffered(segments.length >= 2 ? segments : null);
    })();
    return () => { run.cancelled = true; };
  }, [phase, placeLoading, batch, pool, publisherId, split, splitDismissed]);

  /** Show one place's photos and let the normal post flow handle it. */
  const showLeg = useCallback((segments: PlaceSplitSegment[], index: number): void => {
    const segment = segments[index];
    if (segment == null) return;
    setSlots(segment.batch.map((c: PhotoClassification) => c.candidate.id));
    setExcluded(new Set());
    // Each place names itself; the previous leg's place must not carry over.
    placeEditedRef.current = false;
    setPlace('');
    setPlaceSource(null);
  }, []);

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
    const all = split != null ? (split.segments[split.index]?.pool ?? []) : [...batch, ...pool];
    return config == null ? all : all.filter(c => isSuggestablePhoto(c, config));
  }, [batch, pool, split, config]);

  /**
   * The photos that could go into a slot right now, with no AI call needed —
   * what the swap chip has always felt instant off, and what the "+" spends
   * before it has to ask for more.
   */
  const ready = useMemo(() => {
    // Only once the scan is done: while classifying, the grid shows the
    // running `partial` batch rather than `slots`, so a swap would change
    // state nothing is rendering from — a button that looks live and isn't.
    if (phase !== 'done') return [];
    const usedIds = new Set(slots);
    return offerable.filter(
      c => !excluded.has(c.candidate.id) && !usedIds.has(c.candidate.id),
    );
  }, [phase, slots, excluded, offerable]);
  const nextAvailable = ready[0] ?? null;
  /**
   * Whether another photo can still be produced — either one is already
   * classified and waiting, or the AI can go look at more of the window.
   *
   * Not offered mid-split: a top-up classifies from the whole window, and the
   * leg being posted is one place inside it. Adding a photo from the other city
   * is exactly what splitting was meant to prevent.
   */
  const canOfferMore = nextAvailable != null || (canTopUp && split == null && phase === 'done');
  const hasPool = canOfferMore;

  const shortfall = phase === 'done' && batch.length > 0 && photosPerPost > 0 && batch.length < photosPerPost;

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
    if (phase !== 'done' || split != null) return;
    if (!canTopUp || toppingUp || awaitingAdd || swappingId != null || sharing) return;
    if (kept.length >= MAX_PHOTOS_PER_POST) return;
    if (ready.length > PREFETCH_LOW_WATER) return;

    const timer = setTimeout(() => {
      prefetchBudgetRef.current -= 1;
      void topUp();
    }, PREFETCH_IDLE_MS);
    return () => clearTimeout(timer);
  }, [
    phase, split, canTopUp, toppingUp, awaitingAdd, swappingId, sharing,
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
      if (!canTopUp || split != null) return [];
      const { suggestions, reason } = await topUp();
      setTopUpNote(
        suggestions.length === 0 && reason === 'quota'
          ? "Today's AI limit is used up — try again tomorrow."
          : null,
      );
      return suggestions;
    },
    [offerable, canTopUp, split, topUp],
  );

  function handleAddSlot(): void {
    if (kept.length >= MAX_PHOTOS_PER_POST || awaitingAdd) return;
    wantsMoreRef.current = true;

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
  }

  function handleSwap(id: string): void {
    // One swap at a time. An empty answer here means "drop this photo", so a
    // second swap riding on the first one's result could cost the publisher a
    // photo they never rejected.
    if (swappingId != null) return;
    wantsMoreRef.current = true;
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
          return pick != null
            ? s.map(slotId => (slotId === id ? pick.candidate.id : slotId))
            : s.filter(slotId => slotId !== id);
        });
      } finally {
        setSwappingId(null);
      }
    })();
  }

  const handleConfirm = useCallback((): void => {
    void (async (): Promise<void> => {
      // Batched, not Promise.all: a post can carry up to MAX_PHOTOS_PER_POST
      // photos, and resolving a ph:// handle downloads the full-resolution
      // original from iCloud. All of them at once is the spike issue #77 was.
      const items = await mapInBatches(
        kept,
        PHOTO_METADATA_BATCH_SIZE,
        async c => {
          // ph:// asset handles can't be read by the uploader — resolve to a
          // real file:// path first. Remote https URLs pass through untouched
          // (ShareMediaUseCase skips re-uploading those).
          const isRemote = c.candidate.uri.startsWith('http');
          const localUri = isRemote ? c.candidate.uri : await expoResolveLocalUri(c.candidate);
          // EXIF GPS so the posting gets a place name — usually already
          // fetched by the place-preview effect; fetch here as a fallback.
          let coordinate: Coordinate | undefined = coordsRef.current.get(c.candidate.id);
          if (coordinate == null && !coordsRef.current.has(c.candidate.id)) {
            try {
              const info = await MediaLibrary.getAssetInfoAsync(c.candidate.id);
              if (info.location != null) {
                coordinate = validCoordinate(info.location.latitude, info.location.longitude) ?? undefined;
              }
            } catch { /* no GPS — the posting just goes out without a place */ }
          }
          return {
            mediaId: c.candidate.id,
            localUri,
            filename: c.candidate.uri.split('/').pop() ?? `${c.candidate.id}.jpg`,
            ...(coordinate != null ? { coordinate } : {}),
          };
        },
      );
      if (__DEV__) {
        const withGps = items.filter(i => i.coordinate != null).length;
        console.log(`[share] GPS found on ${withGps}/${items.length} photos`);
      }
      // The user's explicit edit always wins (clearing = post with no place).
      // Otherwise pass the resolved text when we have it, and when the field
      // is still empty/loading pass undefined so the use case auto-resolves —
      // an untouched empty field must never suppress the place.
      const location = placeEditedRef.current
        ? place
        : placeLoading || place === ''
        ? undefined
        : place;
      if (__DEV__) console.log(`[share] place: ${JSON.stringify(location)} (edited: ${placeEditedRef.current}, loading: ${placeLoading})`);
      try {
        await share(items, publisherId, location, pickedCoordinate ?? gpsCoordinate);
        // Posted — this batch is spent; next visit should compute a fresh one.
        void SuggestionCache.clear(publisherId).catch(() => undefined);

        // Mid-split: move to the next place rather than finishing, so the
        // week's second city gets its own post instead of being dropped.
        if (split != null && split.index + 1 < split.segments.length) {
          const next = split.index + 1;
          setSplit({ segments: split.segments, index: next });
          showLeg(split.segments, next);
          return;
        }
        setDone(true);
      } catch {
        /* surfaced via shareError */
      }
    })();
  }, [kept, share, publisherId, place, placeLoading, split, showLeg]);

  if (done) {
    return (
      <View style={[innerStyles.container, { paddingBottom: bottomInset }]}>
        <View style={innerStyles.centered}>
          <View style={innerStyles.successBadge}>
            <Ionicons name="checkmark" size={40} color={colors.onAccent} />
          </View>
          <Text style={innerStyles.successTitle}>Posted!</Text>
          <Text style={innerStyles.successSubtitle}>
            {kept.length} photo{kept.length === 1 ? '' : 's'} sent to your followers.
          </Text>
          <TouchableOpacity style={innerStyles.secondaryButton} onPress={onBack}>
            <Text style={innerStyles.secondaryText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // 'loading' = checking cache; show a plain spinner with no step bar.
  if (phase === 'loading') {
    return (
      <View style={[innerStyles.container, { paddingBottom: bottomInset }]}>
        <View style={innerStyles.header}>
          <View style={innerStyles.headerTop}>
            <TouchableOpacity onPress={onBack} accessibilityLabel="Back" hitSlop={8} style={innerStyles.backButton}>
              <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={innerStyles.title}>Suggested post</Text>
          </View>
        </View>
        <View style={innerStyles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  const isLoading = phase === 'scanning' || phase === 'classifying';

  return (
    <View style={[innerStyles.container, { paddingBottom: bottomInset }]}>
      {/* header */}
      <View style={innerStyles.header}>
        <View style={innerStyles.headerTop}>
          <TouchableOpacity
            onPress={onBack}
            accessibilityLabel="Back"
            hitSlop={8}
            style={innerStyles.backButton}
          >
            <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          <Text style={innerStyles.title}>Suggested post</Text>
        </View>
        <Text style={innerStyles.subtitle}>
          {phase === 'done'
            ? fromCache
              ? `AI pre-selected ${batch.length} photo${batch.length === 1 ? '' : 's'} for you.`
              : `AI picked ${batch.length} photo${batch.length === 1 ? '' : 's'} from ${found} scanned.`
            : phase === 'classifying'
            ? unique > 0
              ? `Checking ${unique} unique photos (${found} scanned, ${found - unique} duplicates removed)`
              : 'Classifying photos…'
            : 'Scanning your library…'}
        </Text>
        {fromCache && phase === 'done' && (
          <TouchableOpacity onPress={reload} hitSlop={8}>
            <Text style={innerStyles.rescanLink}>Rescan library instead</Text>
          </TouchableOpacity>
        )}
        {offered != null && split == null && (
          <View style={splitStyles.card}>
            <Ionicons name="git-branch-outline" size={18} color={colors.accent} />
            <View style={splitStyles.copy}>
              <Text style={splitStyles.title}>You were in {offered.length} places</Text>
              <Text style={splitStyles.body}>
                Splitting keeps each place its own story instead of burying the first one.
              </Text>
            </View>
            <View style={splitStyles.actions}>
              <TouchableOpacity
                testID="review-split-accept"
                style={splitStyles.primary}
                onPress={() => { setSplit({ segments: offered, index: 0 }); setOffered(null); showLeg(offered, 0); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Split into ${offered.length} posts`}
              >
                <Text style={splitStyles.primaryText}>Split</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="review-split-dismiss"
                onPress={() => { setOffered(null); setSplitDismissed(true); }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Keep as one post"
              >
                <Text style={splitStyles.secondaryText}>Keep as one</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {split != null && (
          <View style={splitStyles.legRow}>
            <Ionicons name="location" size={14} color={colors.accent} />
            <Text style={splitStyles.legText}>
              Place {split.index + 1} of {split.segments.length}
              {split.index + 1 < split.segments.length
                ? ' — the next follows once you post this'
                : ' — last one'}
            </Text>
          </View>
        )}

        {shortfall && (
          <Text style={innerStyles.shortfallNote}>
            Only {batch.length} of {photosPerPost} photos found — tap + to look for more, or widen the lookback window in settings.
          </Text>
        )}
        {phase !== 'error' && (
          <StepBar phase={phase} classified={classified} total={total} />
        )}
      </View>

      {/* body */}
      {phase === 'error' ? (
        <View style={innerStyles.centered}>
          <Text style={innerStyles.errorNote}>{error}</Text>
          <TouchableOpacity style={innerStyles.secondaryButton} onPress={reload}>
            <Text style={innerStyles.secondaryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : kept.length === 0 && phase === 'done' ? (
        <View style={innerStyles.centered}>
          <Text style={innerStyles.hint}>No new photos to suggest right now.</Text>
          <TouchableOpacity style={innerStyles.secondaryButton} onPress={reload}>
            <Text style={innerStyles.secondaryText}>Rescan</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={gridStyles.grid} showsVerticalScrollIndicator={false}>
            {kept.map(c => (
              <SuggestionPhotoCard
                key={c.candidate.id}
                photo={c}
                onSwap={hasPool ? () => handleSwap(c.candidate.id) : null}
                busy={swappingId === c.candidate.id}
              />
            ))}
            {/* The empty slot. Always there while the post has room — the
                publisher can go past their configured count, up to the cap. */}
            {phase === 'done' && kept.length > 0 && kept.length < MAX_PHOTOS_PER_POST && (
              awaitingAdd ? (
                <View style={[gridStyles.card, gridStyles.addCard]}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={gridStyles.addLabel}>Finding one more…</Text>
                  <Text style={gridStyles.addHint}>The AI is looking through those days</Text>
                </View>
              ) : canOfferMore ? (
                <TouchableOpacity
                  testID="review-add-photo"
                  style={[gridStyles.card, gridStyles.addCard]}
                  onPress={handleAddSlot}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Add the next suggested photo"
                >
                  <View style={gridStyles.addPlus}>
                    <Ionicons name="add" size={28} color={colors.accent} />
                  </View>
                  <Text style={gridStyles.addLabel}>Add photo</Text>
                  <Text style={gridStyles.addHint}>
                    {photosPerPost > 0 && kept.length < photosPerPost
                      ? `${kept.length}/${photosPerPost} selected`
                      : `${kept.length} selected · up to ${MAX_PHOTOS_PER_POST}`}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View
                  testID="review-add-photo-disabled"
                  style={[gridStyles.card, gridStyles.addCard, gridStyles.addCardDisabled]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: true }}
                  accessibilityLabel="No more photos to add"
                >
                  <View style={[gridStyles.addPlus, gridStyles.addPlusDisabled]}>
                    <Ionicons name="add" size={28} color={colors.textMuted} />
                  </View>
                  <Text style={gridStyles.addLabelDisabled}>No more photos</Text>
                  <Text style={gridStyles.addHint}>
                    {topUpNote ?? 'Nothing else worth posting in those days'}
                  </Text>
                  {split == null && (
                    <TouchableOpacity onPress={reload} hitSlop={8}>
                      <Text style={gridStyles.addRescanLink}>Rescan library</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )
            )}
            {phase === 'done' && kept.length >= MAX_PHOTOS_PER_POST && (
              <Text style={gridStyles.capNote}>
                That's the {MAX_PHOTOS_PER_POST}-photo maximum for one post.
              </Text>
            )}
            {isLoading && kept.length === 0 && (
              <View style={innerStyles.scanningRow}>
                <ActivityIndicator color={colors.accent} />
                <Text style={innerStyles.hint}>
                  {phase === 'scanning' ? 'Scanning your library…' : 'Looking for great photos…'}
                </Text>
              </View>
            )}
            {phase === 'classifying' && kept.length > 0 && (
              <View style={gridStyles.moreSpinner}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={[innerStyles.hint, { marginLeft: 8 }]}>
                  {classified}/{total} checked
                </Text>
              </View>
            )}
          </ScrollView>

          {phase === 'done' && kept.length > 0 && (
            <View style={[innerStyles.footer, keyboardPadding > 0 && { paddingBottom: keyboardPadding }]}>
              {shareError != null && <Text style={innerStyles.errorNote}>{shareError}</Text>}
              <PlaceField
                value={place}
                loading={placeLoading}
                hasGps={gpsCoordinate != null}
                onChange={(label, coordinate) => {
                  placeEditedRef.current = true;
                  setPlaceSource(null);
                  setPlace(label);
                  setPickedCoordinate(coordinate);
                }}
              />
              {placeSource != null && (
                <Text
                  style={[
                    innerStyles.placeSourceNote,
                    placeSource === 'none' && innerStyles.placeSourceWarn,
                  ]}
                >
                  {placeSource === 'photos'
                    ? "Place from the selected photos' GPS"
                    : placeSource === 'scan'
                    ? 'Place from other photos taken around the same time'
                    : 'No place found — the photos carry no GPS. Type one to include it.'}
                </Text>
              )}
              <TouchableOpacity
                style={[innerStyles.confirmButton, sharing && innerStyles.disabled]}
                onPress={handleConfirm}
                disabled={sharing || !canPost}
                activeOpacity={0.85}
              >
                {sharing ? (
                  <View style={innerStyles.progressRow}>
                    <ActivityIndicator color={colors.onAccent} />
                    <Text style={innerStyles.confirmText}>
                      {shareProgress == null
                        ? 'Posting…'
                        : shareProgress.stage === 'uploading'
                        ? `Uploading ${Math.min(shareProgress.done + 1, shareProgress.total)}/${shareProgress.total}…`
                        : 'Sending to followers…'}
                    </Text>
                  </View>
                ) : (
                  <Text style={innerStyles.confirmText}>
                    Post {kept.length} photo{kept.length === 1 ? '' : 's'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </View>
  );
}

// ---------- navigation screen wrapper (for deep-links) ----------

type Props = {
  navigation: RootNavigationProp;
};

export function ReviewSuggestionScreen({ navigation }: Props): React.JSX.Element {
  return (
    <SafeAreaView style={screenStyles.root}>
      <ReviewSuggestionContent onBack={() => navigation.goBack()} />
    </SafeAreaView>
  );
}

// ---------- styles ----------

const innerStyles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.xl },
  header: { paddingTop: spacing.md, paddingBottom: spacing.sm },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.title, color: colors.text, fontSize: 15, flex: 1, textAlign: 'center' },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  shortfallNote: { ...typography.caption, color: '#C87A00', fontSize: 12, marginBottom: spacing.xs },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  scanningRow: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, minHeight: 160, width: '100%' },
  hint: { ...typography.caption, color: colors.textSecondary },
  footer: { paddingVertical: spacing.md },
  placeSourceNote: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: -2,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  placeSourceWarn: { color: '#C87A00' },
  rescanLink: { ...typography.caption, fontSize: 12, color: colors.accent, marginBottom: spacing.xs, textDecorationLine: 'underline' },
  errorNote: { color: colors.danger, fontSize: 13, textAlign: 'center', marginBottom: spacing.sm },
  confirmButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  confirmText: { color: colors.onAccent, fontWeight: '600', fontSize: 15 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  successBadge: {
    width: 80,
    height: 80,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: { ...typography.title, fontSize: 28, color: colors.text },
  successSubtitle: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: spacing.xxl },
  secondaryButton: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.text, fontWeight: '600' },
});

const screenStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});

const stepStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: 4,
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: { backgroundColor: colors.accent },
  dotDone: { backgroundColor: colors.success },
  dotText: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  line: { flex: 1, height: 2, backgroundColor: colors.border },
  lineDone: { backgroundColor: colors.success },
  label: { fontSize: 11, color: colors.textSecondary, minWidth: 50 },
  labelActive: { color: colors.text, fontWeight: '600' },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  pct: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
    width: 34,
    textAlign: 'right',
  },
});

const splitStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  copy: { flex: 1, gap: 2 },
  title: { ...typography.body, fontWeight: '700', color: colors.text },
  body: { ...typography.caption, fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  actions: { alignItems: 'flex-end', gap: spacing.xs },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  primaryText: { ...typography.caption, fontWeight: '700', color: colors.onAccent },
  secondaryText: { ...typography.caption, fontSize: 12, color: colors.textSecondary },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  legText: { ...typography.caption, fontSize: 12, color: colors.textSecondary, flex: 1 },
});

const gridStyles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingBottom: 100,
  },
  card: { width: '47%' },
  photo: { width: '100%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  chip: {
    position: 'absolute',
    bottom: spacing.lg + 18,
    left: spacing.sm,
    backgroundColor: colors.frosted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipText: { ...typography.caption, fontSize: 11, fontWeight: '600', color: colors.ink },
  caption: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: spacing.xs },
  moreSpinner: { width: '100%', alignItems: 'center', paddingVertical: spacing.md },
  // Empty "add photo" slot shown when the batch is below photos-per-post.
  addCard: {
    aspectRatio: 1,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  addCardDisabled: { borderColor: colors.border },
  addPlus: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlusDisabled: { backgroundColor: colors.surface },
  addLabel: { ...typography.caption, fontSize: 12, fontWeight: '600', color: colors.accent },
  addLabelDisabled: { ...typography.caption, fontSize: 12, fontWeight: '600', color: colors.textMuted },
  addRescanLink: { ...typography.caption, fontSize: 11, color: colors.accent, textDecorationLine: 'underline' },
  addHint: { ...typography.caption, fontSize: 10, color: colors.textMuted, textAlign: 'center' },
  capNote: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    width: '100%',
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
});
