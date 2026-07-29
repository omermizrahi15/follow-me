import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { RootNavigationProp } from '../navigation/types';
import { usePublisherId } from '../context/AuthContext';
import { useHistoryBackfill, describeWindow } from '../hooks/useHistoryBackfill';
import { PlaceField } from '../components/PlaceField';
import { SuggestionPhotoCard } from '../components/SuggestionPhotoCard';
import type { ReviewablePosting } from '../hooks/useHistoryBackfill';
import { useKeyboardBottomPadding } from '../hooks/useKeyboardBottomPadding';
import { planHistoryWindows } from '../../domain/services/historyWindows';
import type { HistoryWindow } from '../../domain/services/historyWindows';
import { FREQUENCY_DAYS } from '../../domain/entities/PublisherConfig';
import type { Frequency } from '../../domain/entities/PublisherConfig';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { Coordinate } from '../../domain/interfaces';
import { colors, radius, spacing, typography } from '../theme/theme';

/** Cadence choices, mirroring the auto-posting section plus a free-form option. */
const CADENCES: { value: Frequency; label: string }[] = [
  { value: '3days', label: '3 days' },
  { value: 'weekly', label: '1 week' },
  { value: 'biweekly', label: '2 weeks' },
  { value: 'monthly', label: '30 days' },
];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Jun 2026" — the chosen start, echoed back in full. */
function fullDateLabel(d: Date): string {
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}


// ---------- step 1: setup ----------

function SetupStep({ onStart, initialStartDate = null, gapCount = null, bottomInset = 0 }: {
  onStart: (startDate: Date, intervalDays: number) => void;
  initialStartDate?: Date | null;
  /** How many uncovered stretches were found, when the caller knows. */
  gapCount?: number | null;
  bottomInset?: number;
}): React.JSX.Element {
  const [cadence, setCadence] = useState<Frequency>('weekly');
  // Not editable here: the trip start is set once during onboarding, where it
  // is required. Asking again would be a second source of truth for the one
  // date the whole coverage calculation hangs on.
  const startDate = initialStartDate;
  const keyboardPadding = useKeyboardBottomPadding();

  const intervalDays = FREQUENCY_DAYS[cadence];

  // Planning is pure arithmetic — the count updates live as the publisher taps
  // around, with no scan and no AI spend behind it.
  const plan = useMemo(
    () =>
      startDate != null && intervalDays > 0
        ? planHistoryWindows({ startDate, endDate: new Date(), intervalDays })
        : null,
    [startDate, intervalDays],
  );

  const ready = plan != null && plan.windows.length > 0;

  return (
    <ScrollView
      contentContainerStyle={[styles.body, { paddingBottom: spacing.xxl + keyboardPadding + bottomInset }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.lead}>
        Already travelling before you found Follow Me? Rebuild the story — we’ll suggest
        photos for each stretch, exactly like a normal post.
      </Text>

      <Text style={styles.label}>How often would you have posted?</Text>
      <View style={styles.chipRow}>
        {CADENCES.map(({ value, label }) => (
          <TouchableOpacity
            key={value}
            testID={`backfill-cadence-${value}`}
            style={[styles.chip, cadence === value && styles.chipActive]}
            onPress={() => setCadence(value)}
            activeOpacity={0.7}
            accessibilityRole="radio"
            accessibilityState={{ selected: cadence === value }}
            accessibilityLabel={`Post every ${label}`}
          >
            <Text style={[styles.chipText, cadence === value && styles.chipTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>


      {startDate != null ? (
        <View style={styles.startRow}>
          <Ionicons name="calendar-outline" size={18} color={colors.accent} />
          <Text style={styles.startRowText}>
            Your travels started <Text style={styles.startValue}>{fullDateLabel(startDate)}</Text>
          </Text>
        </View>
      ) : (
        // Only reachable if the profile predates the date being required.
        <View style={styles.previewCard}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.accent} />
          <Text style={styles.previewText}>
            Add the day your travels started in Settings → Edit profile, and we can work
            out what’s missing.
          </Text>
        </View>
      )}

      {plan != null && (
        <View style={styles.previewCard}>
          <Ionicons name="albums-outline" size={18} color={colors.accent} />
          <Text style={styles.previewText}>
            {gapCount != null
              ? `${gapCount} ${gapCount === 1 ? 'stretch' : 'stretches'} of your trip ${gapCount === 1 ? 'has' : 'have'} no post yet. We’ll suggest one for each — the rest is already covered.`
              : plan.windows.length === 0
                ? 'That’s not far enough back to rebuild anything.'
                : `We’ll look through ${plan.windows.length} ${plan.windows.length === 1 ? 'stretch' : 'stretches'} of your history and suggest a post for each.`}
            {plan.truncated &&
              ` That’s as far as one run goes — the other ${plan.total - plan.windows.length} can follow in a second run.`}
          </Text>
        </View>
      )}

      <TouchableOpacity
        testID="backfill-start"
        style={[styles.primaryButton, !ready && styles.buttonDisabled]}
        disabled={!ready}
        onPress={() => { if (startDate != null) onStart(startDate, intervalDays); }}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready }}
        accessibilityLabel="Rebuild my history"
        accessibilityHint={
          ready
            ? `Looks through ${plan.windows.length} stretches of your photo library and suggests a post for each`
            : 'Choose how often you would have posted and when your travels started first'
        }
      >
        <Text style={styles.primaryButtonText}>Rebuild my history</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/** Publish-this-one control, with whatever state that posting is in. */
function PublishOne({ posting, onPublish }: {
  posting: ReviewablePosting;
  onPublish: () => void;
}): React.JSX.Element {
  if (posting.status === 'published') {
    return (
      <View style={styles.publishedRow}>
        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
        <Text style={styles.publishedText}>Added to your story</Text>
      </View>
    );
  }
  if (posting.status === 'publishing') {
    return (
      <View style={styles.publishedRow}>
        <ActivityIndicator color={colors.accent} size="small" />
        <Text style={styles.publishingText}>Uploading…</Text>
      </View>
    );
  }
  return (
    <View style={styles.publishOneRow}>
      <TouchableOpacity
        testID={`backfill-publish-one-${posting.id}`}
        style={styles.publishOneButton}
        onPress={onPublish}
        disabled={posting.dropped || posting.slots.length === 0}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Publish this post now"
        accessibilityHint="Adds this stretch to your story while the rest keep loading"
      >
        <Ionicons name="cloud-upload-outline" size={14} color={colors.onAccent} />
        <Text style={styles.publishOneText}>Publish this one</Text>
      </TouchableOpacity>
      {posting.status === 'failed' && (
        <Text style={styles.publishFailed} numberOfLines={2}>{posting.error ?? 'Failed'}</Text>
      )}
    </View>
  );
}

// ---------- step 2: scanning ----------

function ScanningStep({ current, total, window, classified, of, batch, done, onSwap, onPublishOne, paused, onTogglePause, bottomInset }: {
  current: number;
  total: number;
  /** Dates of the stretch being scanned, known before any photo is picked. */
  window: HistoryWindow | null;
  classified: number;
  of: number;
  batch: PhotoClassification[];
  /** Stretches already reconstructed — the same objects the review step edits. */
  done: ReviewablePosting[];
  onSwap: (postingId: string, photoId: string) => void;
  onPublishOne: (postingId: string) => void;
  paused: boolean;
  onTogglePause: () => void;
  bottomInset: number;
}): React.JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  // Until the publisher opens something themselves, the newest finished stretch
  // stays open so there is always something to look at. The moment they choose,
  // that choice sticks and later stretches arrive folded rather than yanking
  // the view out from under whatever they are reading.
  const [chosen, setChosen] = useState(false);
  const newestId = done.length > 0 ? done[done.length - 1]?.id ?? null : null;
  const effectiveOpenId = chosen ? openId : newestId;
  // "Reading" = they deliberately opened a post. Everything above it then stops
  // moving, so the page can't shift under them.
  const reading = chosen && openId != null;

  const overall = total > 0 ? Math.round(((current - 1) / total) * 100) : 0;
  const withinPct = of > 0 ? Math.round((classified / of) * 100) : 0;

  return (
    <ScrollView contentContainerStyle={[styles.body, { paddingBottom: spacing.xxl * 2 + bottomInset }]}>
      <View accessibilityLiveRegion="polite">
        <Text style={styles.scanTitle} accessibilityRole="header">Rebuilding your travels…</Text>
        <Text style={styles.scanSub}>
          {total > 0 ? `Stretch ${Math.max(current, 1)} of ${total}` : 'Planning the timeline'}
        </Text>
      </View>

      <View style={styles.progressRow}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${overall}%` }]} />
        </View>
        <TouchableOpacity
          testID="backfill-pause"
          style={styles.pauseButton}
          onPress={onTogglePause}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ selected: paused }}
          accessibilityLabel={paused ? 'Resume rebuilding' : 'Pause rebuilding'}
          accessibilityHint="Pausing takes effect after the current stretch finishes"
        >
          <Ionicons name={paused ? 'play' : 'pause'} size={16} color={colors.ink} />
        </TouchableOpacity>
      </View>

      {/* Under the bar, not above it: the dates describe the stretch the bar is
          working through, so they sit with the detail about it rather than in
          the title block. Known from the moment the stretch starts. */}
      {window != null && (
        <Text style={styles.scanDates} accessibilityLiveRegion="polite">
          {describeWindow(window.start, window.end)}
        </Text>
      )}
      {paused && (
        <Text style={styles.scanQuiet}>
          Paused. The stretch already running will finish, then it waits for you.
        </Text>
      )}

      {of > 0 && (
        <>
          <Text style={styles.scanDetail}>
            Looking at {classified} of {of} photos in this stretch
          </Text>
          <View style={styles.trackThin}>
            <View style={[styles.fill, { width: `${withinPct}%` }]} />
          </View>
        </>
      )}

      {/* The stretch being scanned, folded away the moment the publisher opens
          a finished post. This grid GROWS as photos are classified, and sitting
          above the finished list it pushed everything down mid-read — the
          bounce. Folded, the scan carries on silently underneath. No swap
          either way: the batch is still forming, so offering to change it would
          be offering to change a guess. */}
      {batch.length > 0 && !reading && (
        <View style={styles.previewGrid}>
          {batch.map(c => (
            <SuggestionPhotoCard key={c.candidate.id} photo={c} onSwap={null} width="31%" />
          ))}
        </View>
      )}
      {batch.length > 0 && reading && (
        <Text style={styles.scanQuiet}>
          Still working through this stretch — {batch.length} picked so far. It’ll appear below when it’s done.
        </Text>
      )}

      {done.length > 0 && <Text style={styles.label}>Ready to review</Text>}
      {/* Built oldest-first so the trip is reconstructed forwards, but listed
          newest-first like the feed — the most recent stretch on top. */}
      {[...done].reverse().map(posting => {
        const open = effectiveOpenId === posting.id;
        const photos = new Map(
          [...posting.draft.batch, ...posting.draft.pool].map(c => [c.candidate.id, c]),
        );
        const shown = posting.slots
          .map(id => photos.get(id))
          .filter((c): c is PhotoClassification => c != null);
        const spare = [...posting.draft.batch, ...posting.draft.pool].some(
          c => !posting.slots.includes(c.candidate.id),
        );

        return (
          <View key={posting.id} style={styles.doneCard}>
            <TouchableOpacity
              style={styles.doneHeader}
              onPress={() => { setChosen(true); setOpenId(open ? null : posting.id); }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`${describeWindow(posting.draft.window.start, posting.draft.window.end)}, ${shown.length} photos`}
              accessibilityHint={open ? 'Collapses this post' : 'Opens this post to see every photo'}
            >
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <View style={styles.doneHeaderText}>
                <Text style={styles.doneWhen}>
                  {describeWindow(posting.draft.window.start, posting.draft.window.end)}
                </Text>
                <Text style={styles.doneCount}>
                  {shown.length} {shown.length === 1 ? 'photo' : 'photos'}
                  {posting.place !== '' ? ` · ${posting.place}` : ''}
                </Text>
              </View>
              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            <PublishOne posting={posting} onPublish={() => onPublishOne(posting.id)} />

            {open ? (
              <View style={styles.previewGrid}>
                {shown.map(c => (
                  <SuggestionPhotoCard
                    key={c.candidate.id}
                    photo={c}
                    width="31%"
                    onSwap={spare ? () => onSwap(posting.id, c.candidate.id) : null}
                  />
                ))}
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
                {shown.map(c => (
                  <Image key={c.candidate.id} source={{ uri: c.candidate.uri }} style={styles.photo} />
                ))}
              </ScrollView>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

// ---------- step 3: review timeline ----------

function PostingCard({ posting, photos, onToggle, onPlace, onSwap, onPublishOne }: {
  posting: ReviewablePosting;
  photos: Map<string, PhotoClassification>;
  onToggle: () => void;
  onPlace: (place: string, coordinate?: Coordinate) => void;
  onSwap: (photoId: string) => void;
  onPublishOne: () => void;
}): React.JSX.Element {
  const { dropped } = posting;
  return (
    <View style={[styles.card, dropped && styles.cardDropped]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardDate}>
            {describeWindow(posting.draft.window.start, posting.draft.window.end)}
          </Text>
          <Text style={styles.cardCount}>
            {posting.slots.length} {posting.slots.length === 1 ? 'photo' : 'photos'}
          </Text>
        </View>
        <TouchableOpacity
          testID={`backfill-toggle-${posting.id}`}
          onPress={onToggle}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: !dropped }}
          accessibilityLabel={dropped ? 'Include this post' : 'Skip this post'}
          hitSlop={8}
        >
          <Ionicons
            name={dropped ? 'ellipse-outline' : 'checkmark-circle'}
            size={26}
            color={dropped ? colors.textMuted : colors.accent}
          />
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
        {posting.slots.map(id => {
          const photo = photos.get(id);
          if (photo == null) return null;
          return (
            <TouchableOpacity
              key={id}
              onPress={() => onSwap(id)}
              disabled={dropped}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Suggest a different photo"
              accessibilityHint="Replaces this photo with another from the same stretch"
            >
              <Image source={{ uri: photo.candidate.uri }} style={styles.photo} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Same field the live review screen uses: with photo GPS it's just an
          editable label, and without it the search is how this stretch of the
          trip gets onto the globe at all (issue #78). */}
      <PlaceField
        value={posting.place}
        onChange={onPlace}
        loading={posting.placeLoading}
        hasGps={posting.hasGps}
      />

      <PublishOne posting={posting} onPublish={onPublishOne} />
    </View>
  );
}

function ReviewStep({ postings, quotaExhausted, onToggle, onPlace, onSwap, onPublishOne, onPublish, publishing, published, bottomInset }: {
  postings: ReviewablePosting[];
  quotaExhausted: boolean;
  onToggle: (id: string) => void;
  onPlace: (id: string, place: string, coordinate?: Coordinate) => void;
  onSwap: (id: string, photoId: string) => void;
  onPublishOne: (id: string) => void;
  onPublish: () => void;
  publishing: boolean;
  published: number;
  /** Height of the floating nav — without it the last card sits under it. */
  bottomInset: number;
}): React.JSX.Element {
  // Only what is genuinely still outstanding: a stretch already sent on its
  // own must not be counted again, or the button offers to publish it twice.
  const keeping = postings.filter(
    p => !p.dropped && p.slots.length > 0 && p.status !== 'published' && p.status !== 'publishing',
  );

  const photoIndex = useMemo(() => {
    const map = new Map<string, Map<string, PhotoClassification>>();
    postings.forEach(p => {
      const inner = new Map<string, PhotoClassification>();
      [...p.draft.batch, ...p.draft.pool].forEach(c => inner.set(c.candidate.id, c));
      map.set(p.id, inner);
    });
    return map;
  }, [postings]);

  if (postings.length === 0) {
    // Why it is empty matters. A spent AI budget and a genuinely quiet library
    // look identical from here — every window yields nothing either way — and
    // this used to report the second no matter which it was, sending people off
    // to change a start date that was never the problem.
    return (
      <View style={styles.centered}>
        <Ionicons
          name={quotaExhausted ? 'hourglass-outline' : 'images-outline'}
          size={40}
          color={quotaExhausted ? colors.accent : colors.textMuted}
        />
        <Text style={styles.scanTitle}>
          {quotaExhausted ? 'Out of photo analysis for today' : 'Nothing to rebuild'}
        </Text>
        <Text style={styles.scanSub}>
          {quotaExhausted
            ? 'We’ve hit the limit on how many photos can be analysed. Your travels are still there — nothing was lost. Try again later, and if it keeps happening the photo-analysis model may need updating.'
            : 'We found no photos in that stretch of your library. Try an earlier start date.'}
        </Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: spacing.xxl + bottomInset }]}>
        {quotaExhausted && (
          <View style={styles.noticeCard}>
            <Ionicons name="hourglass-outline" size={18} color={colors.accent} />
            <Text style={styles.previewText}>
              That’s today’s photo-analysis budget used up. Everything below is ready to
              publish now — run this again tomorrow to reach further back.
            </Text>
          </View>
        )}
        <Text style={styles.lead}>
          Your travel story, newest first. Untick anything you’d rather not share, tap a
          photo to swap it, and fix any place that looks off.
        </Text>
        {[...postings].reverse().map(p => (
          <PostingCard
            key={p.id}
            posting={p}
            photos={photoIndex.get(p.id) ?? new Map()}
            onToggle={() => onToggle(p.id)}
            onPlace={(place, coordinate) => onPlace(p.id, place, coordinate)}
            onSwap={photoId => onSwap(p.id, photoId)}
            onPublishOne={() => onPublishOne(p.id)}
          />
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: spacing.lg + bottomInset }]}>
        <Text style={styles.footerNote}>
          Your followers won’t be messaged about these — history just appears in your gallery.
        </Text>
        <TouchableOpacity
          testID="backfill-publish"
          style={[styles.primaryButton, (keeping.length === 0 || publishing) && styles.buttonDisabled]}
          disabled={keeping.length === 0 || publishing}
          onPress={onPublish}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: keeping.length === 0 || publishing, busy: publishing }}
          accessibilityLabel={
            publishing
              ? `Publishing, ${published} of ${keeping.length} done`
              : `Add ${keeping.length} ${keeping.length === 1 ? 'post' : 'posts'} to my story`
          }
          accessibilityHint="Your followers are not messaged about these"
        >
          {publishing ? (
            <Text style={styles.primaryButtonText}>
              Publishing {published}/{keeping.length}…
            </Text>
          ) : (
            <Text style={styles.primaryButtonText}>
              {keeping.length === 0
                ? 'All posts added'
                : `Add ${keeping.length} ${keeping.length === 1 ? 'post' : 'posts'} to my story`}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  );
}

// ---------- inner content (usable inline in the sheet OR as a full screen) ----------

interface ContentProps {
  /** Called when the flow finishes or the publisher backs out. */
  onDone: () => void;
  /** Prefills the start date, normally the trip start from the profile. */
  initialStartDate?: Date | null;
  /**
   * The stretches with no posting yet. When given, only these are scanned —
   * the rest of the trip is already covered and rescanning it would burn the
   * day's AI budget for nothing.
   */
  gaps?: HistoryWindow[];
  bottomInset?: number;
}

/**
 * History backfill (issue #81). Publishers who found the app mid-trip
 * reconstruct everything that came before: pick a cadence and a start date,
 * let the same AI pipeline suggest a post per stretch, review the timeline,
 * then publish it back-dated. Nothing here messages a follower.
 */
export function HistoryBackfillContent({ onDone, initialStartDate = null, gaps, bottomInset = 0 }: ContentProps): React.JSX.Element {
  const publisherId = usePublisherId();
  const {
    phase, postings, scanningWindow, totalWindows, quotaExhausted, published, error,
    scanClassified, scanOf, scanBatch, scanWindow, paused, togglePause, publishOne,
    run, toggleDropped, setPlace, swapPhoto, publish, reset,
  } = useHistoryBackfill(publisherId);

  function handlePublish(): void {
    void publish()
      .then(({ published: count, failed, failures }) => {
        const added = `${count} ${count === 1 ? 'post' : 'posts'} added to your story.`;
        // Never round a partial failure up to a success — name which stretches
        // failed and why, so "3 couldn't be uploaded" is something the
        // publisher can actually act on.
        const detail = failures
          .slice(0, 3)
          .map(f => `• ${f.when}: ${f.reason}`)
          .join('\n');
        const more = failures.length > 3 ? `\n…and ${failures.length - 3} more.` : '';
        Alert.alert(
          'Your history is live',
          failed > 0
            ? `${added}\n\n${failed} couldn’t be uploaded — run this again to retry:\n${detail}${more}`
            : added,
          [{ text: 'Done', onPress: onDone }],
        );
      })
      .catch(() => undefined); // surfaced by the error phase below
  }

  return (
    <View style={styles.content}>
      {phase === 'setup' && (
        <SetupStep
          onStart={(startDate, intervalDays) => run(startDate, intervalDays, gaps)}
          initialStartDate={initialStartDate}
          gapCount={gaps?.length ?? null}
          bottomInset={bottomInset}
        />
      )}

      {phase === 'scanning' && (
        <ScanningStep
          paused={paused}
          onTogglePause={togglePause}
          current={scanningWindow}
          total={totalWindows}
          window={scanWindow}
          classified={scanClassified}
          of={scanOf}
          batch={scanBatch}
          done={postings}
          onSwap={swapPhoto}
          onPublishOne={id => void publishOne(id)}
          bottomInset={bottomInset}
        />
      )}

      {(phase === 'review' || phase === 'publishing' || phase === 'done') && (
        <ReviewStep
          postings={postings}
          quotaExhausted={quotaExhausted}
          onToggle={toggleDropped}
          onPlace={setPlace}
          onSwap={swapPhoto}
          onPublishOne={id => void publishOne(id)}
          onPublish={handlePublish}
          publishing={phase === 'publishing'}
          published={published}
          bottomInset={bottomInset}
        />
      )}

      {phase === 'error' && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.danger} />
          <Text style={styles.scanTitle}>Something went wrong</Text>
          <Text style={styles.scanSub}>{error}</Text>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={reset}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Start over"
          >
            <Text style={styles.secondaryButtonText}>Start over</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ---------- full-screen wrapper (modal route) ----------

/** The same flow as its own page, for the `HistoryBackfill` modal route. */
export function HistoryBackfillScreen(): React.JSX.Element {
  const navigation = useNavigation<RootNavigationProp>();
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="backfill-close"
          onPress={() => navigation.goBack()}
          hitSlop={10}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Rebuild my history</Text>
        <View style={styles.headerSpacer} />
      </View>
      <HistoryBackfillContent onDone={() => navigation.goBack()} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: { ...typography.heading, color: colors.text },
  headerSpacer: { width: 24 },

  body: { padding: spacing.lg, gap: spacing.md },
  lead: { ...typography.body, color: colors.textSecondary, lineHeight: 21 },
  label: { ...typography.heading, color: colors.text, marginTop: spacing.sm },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  startRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  startRowText: { ...typography.body, color: colors.text, flex: 1 },
  startValue: { fontWeight: '700', color: colors.accent },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typography.caption, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: colors.onAccent },


  previewCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'flex-start',
  },
  noticeCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'flex-start',
  },
  previewText: { ...typography.caption, color: colors.text, flex: 1, lineHeight: 19 },

  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryButtonText: { ...typography.button, color: colors.onAccent },
  buttonDisabled: { opacity: 0.4 },
  secondaryButton: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
  },
  secondaryButtonText: { ...typography.button, color: colors.text },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  scanTitle: { ...typography.title, color: colors.text, marginTop: spacing.md, textAlign: 'center' },
  scanSub: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  track: {
    height: 6,
    flex: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  trackThin: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: radius.pill },
  scanDates: { ...typography.heading, fontSize: 15, color: colors.accent, marginTop: spacing.sm },
  scanDetail: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
  scanQuiet: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 18 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  pauseButton: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  doneCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  doneHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  doneHeaderText: { flex: 1, gap: 1 },
  publishOneRow: { gap: spacing.xs },
  publishOneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: 7,
  },
  publishOneText: { ...typography.caption, fontWeight: '700', color: colors.onAccent },
  publishedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 4 },
  publishedText: { ...typography.caption, color: colors.success, fontWeight: '600' },
  publishingText: { ...typography.caption, color: colors.accent, fontWeight: '600' },
  publishFailed: { ...typography.caption, fontSize: 11, color: colors.danger },
  doneWhen: { ...typography.heading, fontSize: 15, color: colors.text },
  doneCount: { ...typography.caption, fontSize: 11, color: colors.textMuted },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardDropped: { opacity: 0.45 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeaderText: { gap: 2 },
  cardDate: { ...typography.heading, color: colors.text },
  cardCount: { ...typography.caption, color: colors.textMuted },
  photoRow: { flexDirection: 'row', gap: spacing.sm },
  photo: { width: 84, height: 84, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },

  footer: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  footerNote: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
