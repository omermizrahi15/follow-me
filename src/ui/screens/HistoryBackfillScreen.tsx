import React, { useMemo, useState } from 'react';
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
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { RootNavigationProp } from '../navigation/types';
import { usePublisherId } from '../context/AuthContext';
import { useHistoryBackfill } from '../hooks/useHistoryBackfill';
import { PlaceField } from '../components/PlaceField';
import type { ReviewablePosting } from '../hooks/useHistoryBackfill';
import { useKeyboardBottomPadding } from '../hooks/useKeyboardBottomPadding';
import { planHistoryWindows } from '../../domain/services/historyWindows';
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

/** How many months back the start picker offers. */
const MONTHS_BACK = 36;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Selectable start months, newest first. Month granularity is deliberate: it
 * needs no native date-picker dependency, and nobody remembers that their trip
 * began on the 14th — only which month they set off.
 */
function startMonths(now: Date): Date[] {
  const months: Date[] = [];
  for (let i = 1; i <= MONTHS_BACK; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d);
  }
  return months;
}

function monthLabel(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function rangeLabel(start: Date, end: Date): string {
  const fmt = (d: Date): string => `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
  return `${fmt(start)} – ${fmt(new Date(end.getTime() - 1))}`;
}

// ---------- step 1: setup ----------

function SetupStep({ onStart }: {
  onStart: (startDate: Date, intervalDays: number) => void;
}): React.JSX.Element {
  const [cadence, setCadence] = useState<Frequency | 'other'>('weekly');
  const [customDays, setCustomDays] = useState('10');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const keyboardPadding = useKeyboardBottomPadding();

  const months = useMemo(() => startMonths(new Date()), []);

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
          >
            <Text style={[styles.chipText, cadence === value && styles.chipTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          testID="backfill-cadence-other"
          style={[styles.chip, cadence === 'other' && styles.chipActive]}
          onPress={() => setCadence('other')}
          activeOpacity={0.7}
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
            accessibilityLabel="Days between posts"
          />
          <Text style={styles.customLabel}>days</Text>
        </View>
      )}

      <Text style={styles.label}>When did your travels start?</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthRow}>
        {months.map(m => {
          const selected = startDate?.getTime() === m.getTime();
          return (
            <TouchableOpacity
              key={m.toISOString()}
              testID={`backfill-month-${m.getFullYear()}-${m.getMonth() + 1}`}
              style={[styles.chip, selected && styles.chipActive]}
              onPress={() => setStartDate(m)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, selected && styles.chipTextActive]}>{monthLabel(m)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

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
    <View style={styles.centered}>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={styles.scanTitle}>Rebuilding your travels…</Text>
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
            {rangeLabel(posting.draft.window.start, posting.draft.window.end)}
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
              accessibilityLabel="Suggest a different photo"
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
      .then(({ published: count, failed }) => {
        const added = `${count} ${count === 1 ? 'post' : 'posts'} added to your story.`;
        Alert.alert(
          'Your history is live',
          // Never round a partial failure up to a success — say what didn't make it.
          failed > 0
            ? `${added} ${failed} couldn’t be uploaded — run this again to retry those.`
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
          <TouchableOpacity style={styles.secondaryButton} onPress={reset} activeOpacity={0.8}>
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
  monthRow: { flexDirection: 'row', gap: spacing.sm, paddingRight: spacing.lg },
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
