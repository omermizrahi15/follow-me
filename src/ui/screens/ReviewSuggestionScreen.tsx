import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSuggestedPhotos } from '../hooks/useSuggestedPhotos';
import { useShareMedia } from '../hooks/useShareMedia';
import { useKeyboardBottomPadding } from '../hooks/useKeyboardBottomPadding';
import { useReviewSlots } from '../hooks/useReviewSlots';
import { usePlaceResolution } from '../hooks/usePlaceResolution';
import { usePlaceSplit } from '../hooks/usePlaceSplit';
import { usePublisherId } from '../context/AuthContext';
import { SuggestionCache, expoResolveLocalUri } from '../../composition/container';
import type { Coordinate } from '../../domain/interfaces';
import { MAX_PHOTOS_PER_POST } from '../../domain/entities/PublisherConfig';
import { mapInBatches, PHOTO_METADATA_BATCH_SIZE } from '../../application/services/mapInBatches';
import { relativeTime } from '../../domain/services/photoSyncCopy';
import { scanShortfallNote, scanSummary } from '../../domain/services/reviewCopy';
import type { PlaceSplitSegment } from '../../domain/services/splitSuggestion';
import { SuggestionPhotoCard } from '../components/SuggestionPhotoCard';
import { StepBar } from './review/StepBar';
import { SplitOfferCard, SplitProgress } from './review/SplitOffer';
import { AddPhotoSlot, gridStyles } from './review/PhotoGrid';
import { ReviewFooter } from './review/ReviewFooter';
import { PostedConfirmation } from './review/PostedConfirmation';
import { colors, radius, spacing, typography } from '../theme/theme';

/**
 * Review and send the AI's suggested post.
 *
 * Rendering and wiring only. The three things this screen used to do inline —
 * grid slots and where another photo comes from, resolving the place from photo
 * GPS, and offering to split a week across two cities — are three hooks, and
 * the copy that explains a thin scan is in `domain/services/reviewCopy`.
 *
 * Mounted one way: inline, inside the Me sheet or the onboarding preview. The
 * modal route that also rendered it is gone — the reminder notification now
 * opens the sheet, so there is one set of layout assumptions to verify rather
 * than two.
 */

interface Props {
  onBack: () => void;
  bottomInset?: number;
}

export function ReviewSuggestionContent({ onBack, bottomInset = 0 }: Props): React.JSX.Element {
  const publisherId = usePublisherId();
  const {
    phase, found, unique, classified, total, partial, batch, pool, photosPerPost, config,
    fromCache, cachedAt, stats, error, reload, topUp, toppingUp, canTopUp,
  } = useSuggestedPhotos(publisherId);
  const { share, loading: sharing, error: shareError, progress: shareProgress } = useShareMedia();
  // Keeps the footer's place input above the keyboard (this screen renders in a
  // sheet where KeyboardAvoidingView mis-measures — see the hook doc).
  const keyboardPadding = useKeyboardBottomPadding();
  const [done, setDone] = useState(false);

  // Chained, not circular: the grid decides which photos are in the post, the
  // place is resolved from those photos' GPS, and the split offer needs that
  // resolution to have run before it can tell two stays apart.
  const slots = useReviewSlots({
    phase, batch, partial, pool, photosPerPost, config, topUp, toppingUp, canTopUp, sharing,
  });
  const place = usePlaceResolution({ phase, slots: slots.slots, batch, pool });
  const split = usePlaceSplit({
    phase, placeLoading: place.loading, batch, pool, publisherId,
    coordinateOf: place.coordinateOf,
  });
  const { kept, showSegment } = slots;

  /** Move the grid to one place's photos; each leg names itself afresh. */
  const showLeg = useCallback((leg: PlaceSplitSegment | null): void => {
    if (leg == null) return;
    showSegment(leg);
    place.reset();
  }, [showSegment, place]);

  const handleConfirm = useCallback((): void => {
    void (async (): Promise<void> => {
      // Batched, not Promise.all: a post can carry up to MAX_PHOTOS_PER_POST
      // photos, and resolving a ph:// handle downloads the full-resolution
      // original from iCloud. All of them at once is the spike issue #77 was.
      const items = await mapInBatches(kept, PHOTO_METADATA_BATCH_SIZE, async c => {
        // ph:// asset handles can't be read by the uploader — resolve to a real
        // file:// path first. Remote https URLs pass through untouched
        // (ShareMediaUseCase skips re-uploading those).
        const isRemote = c.candidate.uri.startsWith('http');
        const localUri = isRemote ? c.candidate.uri : await expoResolveLocalUri(c.candidate);
        // EXIF GPS so the posting gets a place name — usually already fetched by
        // the place-preview effect; this is the fallback.
        const coordinate: Coordinate | undefined = await place.resolveCoordinate(c.candidate.id);
        return {
          mediaId: c.candidate.id,
          localUri,
          filename: c.candidate.uri.split('/').pop() ?? `${c.candidate.id}.jpg`,
          ...(coordinate != null ? { coordinate } : {}),
        };
      });
      if (__DEV__) {
        const withGps = items.filter(i => i.coordinate != null).length;
        console.log(`[share] GPS found on ${withGps}/${items.length} photos`);
      }
      const location = place.locationForPost();
      if (__DEV__) console.log(`[share] place: ${JSON.stringify(location)}`);
      try {
        await share(items, publisherId, location, place.pickedCoordinate ?? place.gpsCoordinate);
        // Posted — this batch is spent; next visit should compute a fresh one.
        void SuggestionCache.clear(publisherId).catch(() => undefined);

        // Mid-split: move to the next place rather than finishing, so the
        // week's second city gets its own post instead of being dropped.
        const next = split.advance();
        if (next != null) {
          showLeg(next);
          return;
        }
        setDone(true);
      } catch {
        /* surfaced via shareError */
      }
    })();
  }, [kept, share, publisherId, place, split, showLeg]);

  if (done) {
    return (
      <View style={[styles.container, { paddingBottom: bottomInset }]}>
        <PostedConfirmation photoCount={kept.length} onDone={onBack} />
      </View>
    );
  }

  const header = (
    <View style={styles.headerTop}>
      <TouchableOpacity onPress={onBack} accessibilityLabel="Back" hitSlop={8} style={styles.backButton}>
        <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
      <Text style={styles.title}>Suggested post</Text>
    </View>
  );

  // 'loading' = checking cache; show a plain spinner with no step bar.
  if (phase === 'loading') {
    return (
      <View style={[styles.container, { paddingBottom: bottomInset }]}>
        <View style={styles.header}>{header}</View>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  const isLoading = phase === 'scanning' || phase === 'classifying';
  const shortfallNote = scanShortfallNote(stats);

  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      <View style={styles.header}>
        {header}
        <Text style={styles.subtitle}>
          {phase === 'done'
            ? fromCache
              ? `AI pre-selected ${batch.length} photo${batch.length === 1 ? '' : 's'} for you${
                  cachedAt != null ? ` ${relativeTime(cachedAt, Date.now())}` : ''
                }.`
              : scanSummary(batch.length, stats, found)
            : phase === 'classifying'
            ? unique > 0
              ? `Checking ${unique} unique photos (${found} scanned, ${found - unique} duplicates removed)`
              : 'Classifying photos…'
            : 'Scanning your library…'}
        </Text>
        {/* Rescanning is not a fallback for a stale cache — it is how the
            publisher says "look at what I shot since". It used to appear only
            on a cached batch, so anyone holding a fresh scan that missed today's
            photos had no way to ask for another look. */}
        {phase === 'done' && split.accepted == null && (
          <TouchableOpacity testID="review-rescan" onPress={reload} hitSlop={8}>
            <Text style={styles.rescanLink}>
              {fromCache ? 'Rescan library instead' : 'Rescan library'}
            </Text>
          </TouchableOpacity>
        )}
        {phase === 'done' && !fromCache && shortfallNote != null && (
          <Text style={styles.shortfallNote}>{shortfallNote}</Text>
        )}
        {/* A round that came back empty has to say so where the publisher is
            looking — on the photo they just asked to replace, not only inside
            the "+" card they may never scroll to. */}
        {phase === 'done' && slots.topUpNote != null && (
          <Text testID="review-topup-note" style={styles.shortfallNote}>
            {slots.topUpNote}
          </Text>
        )}
        {split.offered != null && split.accepted == null && (
          <SplitOfferCard
            placeCount={split.offered.length}
            onAccept={() => showLeg(split.accept())}
            onDismiss={split.dismiss}
          />
        )}
        {split.accepted != null && (
          <SplitProgress index={split.accepted.index} total={split.accepted.segments.length} />
        )}
        {slots.shortfall && (
          <Text style={styles.shortfallNote}>
            Only {batch.length} of {photosPerPost} photos found — tap + to look for more, or widen the lookback window in settings.
          </Text>
        )}
        {phase !== 'error' && <StepBar phase={phase} classified={classified} total={total} />}
      </View>

      {phase === 'error' ? (
        <View style={styles.centered}>
          <Text style={styles.errorNote}>{error}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={reload}>
            <Text style={styles.secondaryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : kept.length === 0 && phase === 'done' ? (
        <View style={styles.centered}>
          <Text style={styles.hint}>No new photos to suggest right now.</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={reload}>
            <Text style={styles.secondaryText}>Rescan</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={gridStyles.grid} showsVerticalScrollIndicator={false}>
            {kept.map(c => (
              <SuggestionPhotoCard
                key={c.candidate.id}
                photo={c}
                onSwap={slots.canOfferMore ? () => slots.swap(c.candidate.id) : null}
                busy={slots.swappingId === c.candidate.id}
              />
            ))}
            {phase === 'done' && kept.length > 0 && kept.length < MAX_PHOTOS_PER_POST && (
              <AddPhotoSlot
                busy={slots.awaitingAdd}
                canOfferMore={slots.canOfferMore}
                kept={kept.length}
                photosPerPost={photosPerPost}
                onAdd={slots.addSlot}
                onRescan={split.accepted == null ? reload : null}
              />
            )}
            {phase === 'done' && kept.length >= MAX_PHOTOS_PER_POST && (
              <Text style={gridStyles.capNote}>
                That's the {MAX_PHOTOS_PER_POST}-photo maximum for one post.
              </Text>
            )}
            {isLoading && kept.length === 0 && (
              <View style={styles.scanningRow}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.hint}>
                  {phase === 'scanning' ? 'Scanning your library…' : 'Looking for great photos…'}
                </Text>
              </View>
            )}
            {phase === 'classifying' && kept.length > 0 && (
              <View style={gridStyles.moreSpinner}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={[styles.hint, { marginLeft: 8 }]}>
                  {classified}/{total} checked
                </Text>
              </View>
            )}
          </ScrollView>

          {phase === 'done' && kept.length > 0 && (
            <ReviewFooter
              place={place}
              keptCount={kept.length}
              sharing={sharing}
              shareError={shareError}
              shareProgress={shareProgress}
              keyboardPadding={keyboardPadding}
              onConfirm={handleConfirm}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
  rescanLink: { ...typography.caption, fontSize: 12, color: colors.accent, marginBottom: spacing.xs, textDecorationLine: 'underline' },
  errorNote: { color: colors.danger, fontSize: 13, textAlign: 'center', marginBottom: spacing.sm },
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
