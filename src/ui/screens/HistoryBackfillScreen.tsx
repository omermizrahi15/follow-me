import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Keyboard,
  TextInput,
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
import { CalendarPicker } from '../components/CalendarPicker';
import type { ReviewablePosting } from '../hooks/useHistoryBackfill';
import { useKeyboardBottomPadding } from '../hooks/useKeyboardBottomPadding';
import { planHistoryWindows } from '../../domain/services/historyWindows';
import { startOfDay } from '../../domain/services/calendarMonth';
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

/** How far back the start picker reaches. */
const YEARS_BACK = 5;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Jun 2026" — the chosen start, echoed back in full. */
function fullDateLabel(d: Date): string {
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Jump-to shortcuts, for the common "roughly N months ago" case. */
const QUICK_STARTS: { label: string; monthsAgo: number }[] = [
  { label: '3 months', monthsAgo: 3 },
  { label: '6 months', monthsAgo: 6 },
  { label: '1 year', monthsAgo: 12 },
];

// ---------- step 1: setup ----------

function SetupStep({ onStart }: {
  onStart: (startDate: Date, intervalDays: number) => void;
}): React.JSX.Element {
  const [cadence, setCadence] = useState<Frequency | 'other'>('weekly');
  const [customDays, setCustomDays] = useState('10');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const keyboardPadding = useKeyboardBottomPadding();

  // Pinned once per mount: "today" must not drift mid-session, or the plan
  // preview would silently change under the publisher at midnight.
  const today = useMemo(() => startOfDay(new Date()), []);
  const earliest = useMemo(
    () => new Date(today.getFullYear() - YEARS_BACK, today.getMonth(), today.getDate()),
    [today],
  );

  const intervalDays = useMemo(() => {
    if (cadence !== 'other') return FREQUENCY_DAYS[cadence];
    const parsed = Number.parseInt(customDays, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  }, [cadence, customDays]);

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
      contentContainerStyle={[styles.body, { paddingBottom: spacing.xxl + keyboardPadding }]}
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
        <TouchableOpacity
          testID="backfill-cadence-other"
          style={[styles.chip, cadence === 'other' && styles.chipActive]}
          onPress={() => setCadence('other')}
          activeOpacity={0.7}
          accessibilityRole="radio"
          accessibilityState={{ selected: cadence === 'other' }}
          accessibilityLabel="Other posting frequency"
          accessibilityHint="Lets you type your own number of days between posts"
        >
          <Text style={[styles.chipText, cadence === 'other' && styles.chipTextActive]}>Other</Text>
        </TouchableOpacity>
      </View>

      {cadence === 'other' && (
        <View style={styles.customRow}>
          <Text style={styles.customLabel}>Every</Text>
          <TextInput
            testID="backfill-custom-days"
            style={styles.customInput}
            value={customDays}
            onChangeText={t => setCustomDays(t.replace(/[^0-9]/g, '').slice(0, 3))}
            keyboardType="number-pad"
            maxLength={3}
            returnKeyType="done"
            // The number pad has no return key on iOS; submitting via the
            // keyboard's Done is how a switch-control or keyboard user leaves
            // this field without hunting for a tap target.
            onSubmitEditing={Keyboard.dismiss}
            accessibilityLabel="Days between posts"
            accessibilityHint={`Currently every ${customDays === '' ? 'unset' : customDays} days`}
          />
          <Text style={styles.customLabel}>days</Text>
        </View>
      )}

      <View style={styles.startHeader}>
        <Text style={styles.label}>When did your travels start?</Text>
        {startDate != null && (
          <Text style={styles.startValue} accessibilityLiveRegion="polite">
            {fullDateLabel(startDate)}
          </Text>
        )}
      </View>

      {/* Shortcuts for the vague case; the calendar below is there for the
          publisher who knows they flew out on the 14th. */}
      <View style={styles.chipRow}>
        {QUICK_STARTS.map(({ label, monthsAgo }) => {
          const target = new Date(today.getFullYear(), today.getMonth() - monthsAgo, today.getDate());
          const selected = startDate != null && startDate.getTime() === target.getTime();
          return (
            <TouchableOpacity
              key={label}
              testID={`backfill-quick-${monthsAgo}`}
              style={[styles.chip, selected && styles.chipActive]}
              onPress={() => setStartDate(target)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${label} ago`}
              accessibilityHint={`Starts your history on ${fullDateLabel(target)}`}
            >
              <Text style={[styles.chipText, selected && styles.chipTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <CalendarPicker
        value={startDate}
        onChange={setStartDate}
        minDate={earliest}
        maxDate={today}
      />

      {plan != null && (
        <View style={styles.previewCard}>
          <Ionicons name="albums-outline" size={18} color={colors.accent} />
          <Text style={styles.previewText}>
            {plan.windows.length === 0
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

// ---------- step 2: scanning ----------

function ScanningStep({ current, total }: { current: number; total: number }): React.JSX.Element {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <View style={styles.centered} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={styles.scanTitle} accessibilityRole="header">Rebuilding your travels…</Text>
      <Text style={styles.scanSub}>
        {total > 0 ? `Stretch ${Math.max(current, 1)} of ${total}` : 'Planning the timeline'}
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

// ---------- step 3: review timeline ----------

function PostingCard({ posting, photos, onToggle, onPlace, onSwap }: {
  posting: ReviewablePosting;
  photos: Map<string, PhotoClassification>;
  onToggle: () => void;
  onPlace: (place: string, coordinate?: Coordinate) => void;
  onSwap: (photoId: string) => void;
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
    </View>
  );
}

function ReviewStep({ postings, quotaExhausted, onToggle, onPlace, onSwap, onPublish, publishing, published }: {
  postings: ReviewablePosting[];
  quotaExhausted: boolean;
  onToggle: (id: string) => void;
  onPlace: (id: string, place: string, coordinate?: Coordinate) => void;
  onSwap: (id: string, photoId: string) => void;
  onPublish: () => void;
  publishing: boolean;
  published: number;
}): React.JSX.Element {
  const keeping = postings.filter(p => !p.dropped && p.slots.length > 0);

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
    return (
      <View style={styles.centered}>
        <Ionicons name="images-outline" size={40} color={colors.textMuted} />
        <Text style={styles.scanTitle}>Nothing to rebuild</Text>
        <Text style={styles.scanSub}>
          We found no photos in that stretch of your library. Try an earlier start date.
        </Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.body}>
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
        {postings.map(p => (
          <PostingCard
            key={p.id}
            posting={p}
            photos={photoIndex.get(p.id) ?? new Map()}
            onToggle={() => onToggle(p.id)}
            onPlace={(place, coordinate) => onPlace(p.id, place, coordinate)}
            onSwap={photoId => onSwap(p.id, photoId)}
          />
        ))}
      </ScrollView>

      <View style={styles.footer}>
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
              Add {keeping.length} {keeping.length === 1 ? 'post' : 'posts'} to my story
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  );
}

// ---------- screen ----------

/**
 * History backfill (issue #81). Publishers who found the app mid-trip
 * reconstruct everything that came before: pick a cadence and a start month,
 * let the same AI pipeline suggest a post per stretch, review the timeline,
 * then publish it back-dated. Nothing here messages a follower.
 */
export function HistoryBackfillScreen(): React.JSX.Element {
  const navigation = useNavigation<RootNavigationProp>();
  const publisherId = usePublisherId();
  const {
    phase, postings, scanningWindow, totalWindows, quotaExhausted, published, error,
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
          [{ text: 'Done', onPress: () => navigation.goBack() }],
        );
      })
      .catch(() => undefined); // surfaced by the error phase below
  }

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

      {phase === 'setup' && <SetupStep onStart={run} />}

      {phase === 'scanning' && <ScanningStep current={scanningWindow} total={totalWindows} />}

      {(phase === 'review' || phase === 'publishing' || phase === 'done') && (
        <ReviewStep
          postings={postings}
          quotaExhausted={quotaExhausted}
          onToggle={toggleDropped}
          onPlace={setPlace}
          onSwap={swapPhoto}
          onPublish={handlePublish}
          publishing={phase === 'publishing'}
          published={published}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
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
  startHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  startValue: { ...typography.body, fontWeight: '700', color: colors.accent },
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

  customRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  customLabel: { ...typography.body, color: colors.textSecondary },
  customInput: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 60,
    textAlign: 'center',
  },

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
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    width: '80%',
    marginTop: spacing.lg,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: radius.pill },

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
