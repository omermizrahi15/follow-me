import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import type { RootNavigationProp, RootStackParamList } from '../navigation/types';
import { useSuggestedPhotos } from '../hooks/useSuggestedPhotos';
import { useShareMedia } from '../hooks/useShareMedia';
import { useKeyboardBottomPadding } from '../hooks/useKeyboardBottomPadding';
import { usePublisherId } from '../context/AuthContext';
import { SuggestionCache } from '../../infrastructure/cache/SuggestionCache';
import { expoResolveLocalUri } from '../../infrastructure/media/ExpoMediaLibrary';
import { resolvePlaceForCoordinates } from '../../composition/container';
import * as MediaLibrary from 'expo-media-library';
import type { Coordinate } from '../../domain/interfaces';
import { validCoordinate } from '../../domain/services/coordinate';
import { suggestPlaceFromGuesses } from '../../domain/services/postingLocation';
import type { PhotoCategory, PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { Song } from '../../domain/entities/Song';
import { SongPickerSheet } from '../components/SongPickerSheet';
import { colors, radius, spacing, typography } from '../theme/theme';

const CATEGORY_LABEL: Record<PhotoCategory, string> = {
  selfie_with_view: 'People + view',
  sunset_sunrise: 'Sunset / sunrise',
  architecture: 'Architecture',
  selfie_with_people: 'People',
  food: 'Food',
  nature: 'Nature',
  night_scene: 'Night scene',
  cultural: 'Cultural',
  other: 'Other',
};

// ---------- step indicator ----------

const STEPS = ['Scanning', 'Classifying', 'Done'] as const;

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

// ---------- photo grid ----------

function PhotoCard({ c, onSwap }: {
  c: PhotoClassification;
  onSwap: (() => void) | null;
}): React.JSX.Element {
  return (
    <View style={gridStyles.card}>
      <Image source={{ uri: c.candidate.uri }} style={gridStyles.photo} />
      <TouchableOpacity
        style={gridStyles.chip}
        onPress={onSwap ?? undefined}
        disabled={onSwap == null}
        activeOpacity={onSwap != null ? 0.7 : 1}
        accessibilityLabel="Suggest a different photo"
        hitSlop={4}
      >
        <Text style={gridStyles.chipText}>{CATEGORY_LABEL[c.category]}</Text>
        {onSwap != null && (
          <Ionicons name="refresh" size={10} color={colors.ink} style={{ marginLeft: 3 }} />
        )}
      </TouchableOpacity>
      {c.caption !== '' && (
        <Text style={gridStyles.caption} numberOfLines={1}>{c.caption}</Text>
      )}
    </View>
  );
}

// ---------- inner content (usable inline in the sheet OR as a full screen) ----------

interface ContentProps {
  onBack: () => void;
  bottomInset?: number;
  /** When true the batch is auto-posted as soon as it loads (from "Post now" notification action). */
  autoConfirm?: boolean;
}

export function ReviewSuggestionContent({ onBack, bottomInset = 0, autoConfirm = false }: ContentProps): React.JSX.Element {
  const publisherId = usePublisherId();
  const { phase, found, unique, classified, total, partial, batch, pool, photosPerPost, fromCache, error, reload } = useSuggestedPhotos(publisherId);
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
  // Which step of the resolution chain produced the place — surfaced under the
  // field so an empty suggestion is explained, never silent (issue #63).
  const [placeSource, setPlaceSource] = useState<'photos' | 'scan' | 'ai' | 'none' | null>(null);
  // Posting song — optional, picked via the same sheet as the manual Upload flow.
  const [song, setSong] = useState<Song | null>(null);
  const [songPickerOpen, setSongPickerOpen] = useState(false);
  // GPS per asset id (undefined = probed, no GPS), fetched once for the
  // place preview and reused on post.
  const coordsRef = useRef<Map<string, Coordinate | undefined>>(new Map());

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
      setSong(null);
    }
    if (phase === 'done' && !slotsInitRef.current && batch.length > 0) {
      slotsInitRef.current = true;
      setSlots(batch.slice(0, photosPerPost).map(c => c.candidate.id));
    }
  }, [phase, batch, photosPerPost]);

  // Resolve the batch's place whenever the selection changes, so the user
  // sees (and can edit) the place before posting. Their manual edit always
  // wins over re-resolution. Resolution order — a suggestion must appear even
  // when the selected photos carry no GPS:
  //   1. GPS of the selected photos → reverse geocode.
  //   2. GPS of any other photo from the same scan (batch + pool) — same
  //      lookback window, almost always the same trip.
  //   3. The AI's content-based place guess(es) across the batch.
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
        let source: 'photos' | 'scan' | 'ai' = 'photos';
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

        let resolved = coordinates.length > 0 ? await resolvePlaceForCoordinates(coordinates) : null;
        if (isStale()) return;

        // No GPS anywhere (or the geocoder failed) — fall back to what the AI
        // saw in the photos, selected ones first.
        if (resolved == null) {
          const byId = new Map([...batch, ...pool].map(c => [c.candidate.id, c]));
          const selectedGuesses = slots.map(id => byId.get(id)?.place);
          resolved =
            suggestPlaceFromGuesses(selectedGuesses) ??
            suggestPlaceFromGuesses([...batch, ...pool].map(c => c.place));
          source = 'ai';
        }
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

  // Next unused, unexcluded photo — powers both swap and the "add photo" slot.
  const nextAvailable = useMemo(() => {
    if (phase !== 'done') return null;
    const usedIds = new Set(slots);
    return (
      [...batch, ...pool].find(
        c => !excluded.has(c.candidate.id) && !usedIds.has(c.candidate.id),
      ) ?? null
    );
  }, [phase, slots, excluded, batch, pool]);
  const hasPool = nextAvailable != null;

  const shortfall = phase === 'done' && batch.length > 0 && photosPerPost > 0 && batch.length < photosPerPost;

  function handleAddSlot(): void {
    if (nextAvailable != null) {
      setSlots(s => [...s, nextAvailable.candidate.id]);
    }
  }

  function handleSwap(id: string): void {
    const newExcluded = new Set(excluded);
    newExcluded.add(id);
    const usedIds = new Set(slots);
    // Find the next available photo that is neither already shown nor excluded.
    const replacement = [...batch, ...pool].find(
      c => !newExcluded.has(c.candidate.id) && !usedIds.has(c.candidate.id),
    );
    setExcluded(newExcluded);
    setSlots(
      replacement
        ? slots.map(slotId => (slotId === id ? replacement.candidate.id : slotId))
        : slots.filter(slotId => slotId !== id),
    );
  }

  const handleConfirm = useCallback((): void => {
    void (async (): Promise<void> => {
      const items = await Promise.all(
        kept.map(async c => {
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
        }),
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
        await share(items, publisherId, location, song ?? undefined);
        // Posted — this batch is spent; next visit should compute a fresh one.
        void SuggestionCache.clear(publisherId).catch(() => undefined);
        setDone(true);
      } catch {
        /* surfaced via shareError */
      }
    })();
  }, [kept, share, publisherId, place, placeLoading, song]);

  // "Post now" notification action: auto-post as soon as the batch is ready.
  const confirmedRef = useRef(false);
  useEffect(() => {
    if (autoConfirm && phase === 'done' && kept.length > 0 && !done && !confirmedRef.current) {
      confirmedRef.current = true;
      handleConfirm();
    }
  }, [autoConfirm, phase, kept.length, done, handleConfirm]);

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
        {shortfall && (
          <Text style={innerStyles.shortfallNote}>
            Only {batch.length} of {photosPerPost} photos found — try expanding the lookback window in settings.
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
              <PhotoCard
                key={c.candidate.id}
                c={c}
                onSwap={hasPool ? () => handleSwap(c.candidate.id) : null}
              />
            ))}
            {/* Empty slot — batch is below the configured photos-per-post. */}
            {phase === 'done' && kept.length > 0 && photosPerPost > 0 && kept.length < photosPerPost && (
              hasPool ? (
                <TouchableOpacity
                  style={[gridStyles.card, gridStyles.addCard]}
                  onPress={handleAddSlot}
                  activeOpacity={0.7}
                  accessibilityLabel="Add the next suggested photo"
                >
                  <View style={gridStyles.addPlus}>
                    <Ionicons name="add" size={28} color={colors.accent} />
                  </View>
                  <Text style={gridStyles.addLabel}>Add photo</Text>
                  <Text style={gridStyles.addHint}>{kept.length}/{photosPerPost} selected</Text>
                </TouchableOpacity>
              ) : (
                <View style={[gridStyles.card, gridStyles.addCard, gridStyles.addCardDisabled]}>
                  <View style={[gridStyles.addPlus, gridStyles.addPlusDisabled]}>
                    <Ionicons name="add" size={28} color={colors.textMuted} />
                  </View>
                  <Text style={gridStyles.addLabelDisabled}>No more photos</Text>
                  <TouchableOpacity onPress={reload} hitSlop={8}>
                    <Text style={gridStyles.addRescanLink}>Rescan library</Text>
                  </TouchableOpacity>
                  <Text style={gridStyles.addHint}>or adjust categories in settings</Text>
                </View>
              )
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
              <View style={innerStyles.placeRow}>
                <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                <TextInput
                  style={innerStyles.placeInput}
                  value={place}
                  onChangeText={text => {
                    placeEditedRef.current = true;
                    setPlaceSource(null);
                    setPlace(text);
                  }}
                  placeholder={placeLoading ? 'Finding the place…' : 'Add a place (optional)'}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="done"
                  accessibilityLabel="Posting place"
                />
                {placeLoading ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : place !== '' ? (
                  <TouchableOpacity
                    onPress={() => {
                      placeEditedRef.current = true;
                      setPlaceSource(null);
                      setPlace('');
                    }}
                    hitSlop={8}
                    accessibilityLabel="Clear place"
                  >
                    <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ) : null}
              </View>
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
                    : placeSource === 'ai'
                    ? 'Place guessed by AI from the photo content'
                    : 'No place found — the photos carry no GPS and the AI made no guess. Type one to include it.'}
                </Text>
              )}
              {song == null ? (
                <TouchableOpacity
                  testID="review-add-song"
                  style={innerStyles.songRow}
                  onPress={() => setSongPickerOpen(true)}
                  accessibilityLabel="Add a song"
                >
                  <Ionicons name="musical-notes-outline" size={16} color={colors.textSecondary} />
                  <Text style={innerStyles.songPlaceholder}>Add a song (optional)</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ) : (
                <View style={innerStyles.songRow}>
                  {song.artworkUrl != null ? (
                    <Image source={{ uri: song.artworkUrl }} style={innerStyles.songArt} />
                  ) : (
                    <Ionicons name="musical-notes" size={16} color={colors.accent} />
                  )}
                  <TouchableOpacity
                    style={innerStyles.songNames}
                    onPress={() => setSongPickerOpen(true)}
                    accessibilityLabel="Change song"
                  >
                    <Text style={innerStyles.songText} numberOfLines={1}>
                      {song.title} <Text style={innerStyles.songArtistText}>— {song.artist}</Text>
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setSong(null)}
                    hitSlop={8}
                    accessibilityLabel="Remove song"
                  >
                    <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              )}
              <TouchableOpacity
                style={[innerStyles.confirmButton, sharing && innerStyles.disabled]}
                onPress={handleConfirm}
                disabled={sharing}
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

      <SongPickerSheet
        visible={songPickerOpen}
        place={placeLoading ? undefined : place || undefined}
        photoUris={kept.map(c => c.candidate.uri)}
        onSelect={s => {
          setSong(s);
          setSongPickerOpen(false);
        }}
        onClose={() => setSongPickerOpen(false)}
      />
    </View>
  );
}

// ---------- navigation screen wrapper (for deep-links) ----------

type Props = {
  navigation: RootNavigationProp;
  route: RouteProp<RootStackParamList, 'ReviewSuggestion'>;
};

export function ReviewSuggestionScreen({ navigation, route }: Props): React.JSX.Element {
  return (
    <SafeAreaView style={screenStyles.root}>
      <ReviewSuggestionContent
        onBack={() => navigation.goBack()}
        autoConfirm={route.params?.autoConfirm ?? false}
      />
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
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  placeInput: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: 14,
    color: colors.text,
  },
  placeSourceNote: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: -2,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  placeSourceWarn: { color: '#C87A00' },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  songPlaceholder: { flex: 1, fontSize: 14, color: colors.textMuted },
  songArt: { width: 24, height: 24, borderRadius: radius.sm, backgroundColor: colors.surface },
  songNames: { flex: 1 },
  songText: { fontSize: 14, color: colors.text, fontWeight: '600' },
  songArtistText: { color: colors.textSecondary, fontWeight: '400' },
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
});
