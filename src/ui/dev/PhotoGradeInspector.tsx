import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { GradeExplanation } from '../../domain/services/gradeExplanation';
import { showDevTools } from '../data/devTools';
import { useGradeInspection } from '../hooks/useGradeInspection';
import { colors, radius, spacing, typography } from '../theme/theme';

/**
 * Every photo the AI has graded, worst to best, with its working shown.
 *
 * The suggestion algorithm was only ever observable through its output: a post
 * appeared, some photos were in it, and a publisher who disagreed had no way to
 * tell a harsh grade from a mis-read photo from a setting of their own that
 * quietly excluded it. "The suggestions are bad" was unanswerable, because
 * nothing anywhere said what any individual photo scored or why.
 *
 * So this shows, for every graded photo: the score, the factors it was
 * multiplied from (they multiply out to exactly the score printed above them),
 * every rule that excluded it, and the model's own sentence about what it saw.
 * Sorted by score, so the ordering on screen IS the ordering the post is chosen
 * from — the top `photosPerPost` rows are the post.
 *
 * Reads the grade cache rather than running a scan: no AI budget is spent, so
 * it can be opened as often as it takes to understand something.
 *
 * Dev and staging builds only. `metro.config.js` swaps this module for a stub
 * at resolution time in a production bundle, so none of it ships; the
 * `showDevTools` check below is the second line of defence.
 */
export function PhotoGradeInspector({
  publisherId,
  onClose,
}: {
  publisherId: string;
  onClose?: () => void;
}): React.JSX.Element | null {
  const inspection = useGradeInspection(publisherId);
  const [filter, setFilter] = useState<Filter>('all');

  const photos = useMemo(
    () => (inspection.data?.photos ?? []).filter(p => matches(p, filter)),
    [inspection.data, filter],
  );

  if (!showDevTools) return null;

  return (
    <View style={styles.screen} testID="photo-grade-inspector">
      <View style={styles.header}>
        <Text style={styles.title}>Photo grades</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={inspection.reload} testID="grade-inspector-reload">
            <Ionicons name="refresh" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          {onClose != null && (
            <TouchableOpacity onPress={onClose} testID="grade-inspector-close">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Summary inspection={inspection} />
      <Filters current={filter} onChange={setFilter} />

      {inspection.loading && photos.length === 0 ? (
        <ActivityIndicator style={styles.loading} color={colors.accent} />
      ) : (
        <FlatList
          data={photos}
          keyExtractor={p => p.facts.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <GradeRow explanation={item} />}
          ListEmptyComponent={<Empty error={inspection.error} filter={filter} />}
        />
      )}
    </View>
  );
}

/**
 * The Settings row that opens the inspector, and the modal it opens.
 *
 * Lives in this module rather than in SettingsScreen so the row disappears with
 * the screen: `metro.config.js` swaps this whole file for a stub in production,
 * and a row left behind in the settings list would be a button that opens
 * nothing. One import, one thing to keep in step.
 */
export function PhotoGradeInspectorCard({
  publisherId,
}: {
  publisherId: string;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);

  if (!showDevTools) return null;

  return (
    <View>
      <Text style={styles.sectionLabel}>AI debugging (staging)</Text>
      <TouchableOpacity
        testID="open-grade-inspector"
        style={styles.entryRow}
        onPress={() => setOpen(true)}
      >
        <View style={styles.entryIcon}>
          <Ionicons name="analytics-outline" size={20} color={colors.accent} />
        </View>
        <View style={styles.entryText}>
          <Text style={styles.entryTitle}>Photo grades</Text>
          <Text style={styles.entryValue}>
            Every graded photo, ranked, with the reason for each score
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.screen}>
          <PhotoGradeInspector publisherId={publisherId} onClose={() => setOpen(false)} />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

type Filter = 'all' | 'in-post' | 'blocked';

function matches(photo: GradeExplanation<PhotoClassification>, filter: Filter): boolean {
  if (filter === 'in-post') return photo.inBatch;
  if (filter === 'blocked') return photo.blockers.length > 0;
  return true;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in-post', label: 'In next post' },
  { key: 'blocked', label: 'Excluded' },
];

function Filters({
  current,
  onChange,
}: {
  current: Filter;
  onChange: (f: Filter) => void;
}): React.JSX.Element {
  return (
    <View style={styles.filters}>
      {FILTERS.map(f => (
        <TouchableOpacity
          key={f.key}
          testID={`grade-filter-${f.key}`}
          onPress={() => onChange(f.key)}
          style={[styles.chip, current === f.key && styles.chipOn]}
        >
          <Text style={[styles.chipText, current === f.key && styles.chipTextOn]}>{f.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Summary({
  inspection,
}: {
  inspection: ReturnType<typeof useGradeInspection>;
}): React.JSX.Element | null {
  const s = inspection.data?.summary;
  if (s == null) return null;
  return (
    <View style={styles.summary} testID="grade-inspector-summary">
      <Stat label="Graded" value={String(s.graded)} />
      <Stat label="Eligible" value={String(s.eligible)} />
      <Stat label="Excluded" value={String(s.blocked)} />
      <Stat label="In post" value={String(s.inBatch)} />
      <Stat label="Avg quality" value={s.averageQuality.toFixed(2)} />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * One photo, its arithmetic, and the model's account of it.
 *
 * The factor rows are the point. They multiply out to the score printed beside
 * the thumbnail — so a publisher who thinks a photo is ranked too low can see
 * whether it was the model's quality call, their own category order, or the
 * face preference that did it, rather than guessing at all three.
 */
function GradeRow({
  explanation,
}: {
  explanation: GradeExplanation<PhotoClassification>;
}): React.JSX.Element {
  const { item, facts, score, factors, blockers, rank, inBatch, sceneCapped } = explanation;
  const excluded = blockers.length > 0;

  return (
    <View style={[styles.row, excluded && styles.rowExcluded]} testID={`grade-row-${facts.id}`}>
      <View style={styles.rowTop}>
        <Image source={{ uri: item.candidate.uri }} style={styles.thumb} />
        <View style={styles.rowHead}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rank}>#{rank}</Text>
            {inBatch && (
              <View style={styles.badge} testID={`grade-badge-${facts.id}`}>
                <Text style={styles.badgeText}>IN POST</Text>
              </View>
            )}
            {sceneCapped && (
              <View style={[styles.badge, styles.badgeMuted]}>
                <Text style={styles.badgeText}>SCENE CAP</Text>
              </View>
            )}
          </View>
          <Text style={styles.score} testID={`grade-score-${facts.id}`}>
            {score.toFixed(3)}
          </Text>
          <Text style={styles.caption} numberOfLines={2}>
            {item.caption || '(no caption)'}
          </Text>
          <Text style={styles.meta}>
            {facts.category} · scene “{facts.scene || '—'}” · confidence{' '}
            {item.confidence.toFixed(2)}
          </Text>
        </View>
      </View>

      {/* The working. Printed as an equation rather than a table because the
          claim being made is that these numbers produce that score, and an
          equation is checkable at a glance. */}
      <View style={styles.factors}>
        {factors.map(f => (
          <View key={f.key} style={styles.factor}>
            <Text style={styles.factorLabel}>{f.label}</Text>
            <Text style={styles.factorValue}>×{f.value.toFixed(2)}</Text>
            <Text style={styles.factorDetail} numberOfLines={1}>
              {f.detail}
            </Text>
          </View>
        ))}
        <Text style={styles.equation}>
          {factors.map(f => f.value.toFixed(2)).join(' × ')} = {score.toFixed(3)}
        </Text>
      </View>

      {/* The model's own words. The single thing that distinguishes "the AI
          graded this harshly" from "the AI was looking at something else". */}
      {item.reason !== '' && (
        <View style={styles.reason} testID={`grade-reason-${facts.id}`}>
          <Ionicons name="chatbox-ellipses-outline" size={13} color={colors.textMuted} />
          <Text style={styles.reasonText}>{item.reason}</Text>
        </View>
      )}
      {item.reason === '' && (
        <Text style={styles.noReason}>
          No reason recorded — graded before the model was asked for one.
        </Text>
      )}

      {blockers.map(b => (
        <View key={b.key} style={styles.blocker} testID={`grade-blocker-${facts.id}-${b.key}`}>
          <Ionicons name="close-circle" size={14} color={colors.danger} />
          <Text style={styles.blockerText}>
            {b.label} — {b.detail}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Empty({ error, filter }: { error: Error | null; filter: Filter }): React.JSX.Element {
  // A failed read and an empty library look identical as a blank list, and mean
  // opposite things — so the error says so in its own words.
  if (error != null) {
    return (
      <Text style={styles.empty} testID="grade-inspector-error">
        Could not read the grades: {error.message}
      </Text>
    );
  }
  return (
    <Text style={styles.empty}>
      {filter === 'all'
        ? 'Nothing graded yet. Run a scan from the home screen and come back.'
        : 'No photos match this filter.'}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  entryIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryText: { flex: 1 },
  entryTitle: { ...typography.body, fontSize: 14, fontWeight: '600', color: colors.text },
  entryValue: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  headerActions: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  title: { ...typography.body, fontSize: 18, fontWeight: '700', color: colors.text },
  loading: { marginTop: spacing.xxl },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { ...typography.body, fontSize: 16, fontWeight: '700', color: colors.text },
  statLabel: { ...typography.caption, fontSize: 11, color: colors.textMuted },
  filters: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  chipOn: { backgroundColor: colors.accent },
  chipText: { ...typography.caption, color: colors.textSecondary },
  chipTextOn: { color: colors.onAccent, fontWeight: '600' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  rowExcluded: { opacity: 0.72, borderColor: colors.danger },
  rowTop: { flexDirection: 'row', gap: spacing.md },
  thumb: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  rowHead: { flex: 1 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rank: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  badge: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  badgeMuted: { backgroundColor: colors.surfaceAlt },
  badgeText: { ...typography.caption, fontSize: 10, fontWeight: '700', color: colors.accent },
  score: { ...typography.body, fontSize: 20, fontWeight: '700', color: colors.text },
  caption: { ...typography.caption, color: colors.textSecondary },
  meta: { ...typography.caption, fontSize: 11, color: colors.textMuted, marginTop: 2 },
  factors: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 2,
  },
  factor: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  factorLabel: { ...typography.caption, fontSize: 11, color: colors.text, width: 92 },
  factorValue: { ...typography.caption, fontSize: 11, fontWeight: '700', color: colors.text, width: 46 },
  factorDetail: { ...typography.caption, fontSize: 11, color: colors.textMuted, flex: 1 },
  equation: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    fontWeight: '600',
  },
  reason: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  reasonText: { ...typography.caption, color: colors.textSecondary, flex: 1, fontStyle: 'italic' },
  noReason: { ...typography.caption, fontSize: 11, color: colors.textMuted },
  blocker: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  blockerText: { ...typography.caption, color: colors.danger, flex: 1 },
  empty: { ...typography.caption, color: colors.textMuted, textAlign: 'center', padding: spacing.xl },
});
