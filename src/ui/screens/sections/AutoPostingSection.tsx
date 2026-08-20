import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { usePublisherId } from '../../context/AuthContext';
import { saveConfig, scheduleReminder, registerPushToken } from '../../../composition/container';
import type { PhotoCount, PhotosOfMe } from '../../../domain/entities/PublisherConfig';
import { useProfile } from '../../hooks/useProfile';
import { isPhotoSyncEnabled, enablePhotoSync } from '../../data/photoSyncConsent';
import { runCandidateSyncQuietly } from '../../data/candidateSync';
import { useAutoPostingConfig, snapshotOf } from '../../hooks/useAutoPostingConfig';
import { AutoPostingForm, styles as formStyles } from './AutoPostingForm';
import { CategoryReorderList } from './CategoryReorderList';
import { PhotoSyncStatus } from './PhotoSyncStatus';
import { DevNotificationPanel } from '../../dev/DevNotificationPanel';
import { colors, radius, spacing, typography } from '../../theme/theme';

interface Props {
  bottomInset: number;
  onPreview: () => void;
}

/**
 * How long a change waits before it is written. Long enough that a burst of
 * taps (frequency → day → time) is one round trip, short enough that leaving
 * the section straight after a tap still lands the write.
 */
const AUTOSAVE_MS = 700;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The "photos of me" choices, in the order they escalate (issue #137).
 *
 * `only` is a genuine filter — it can leave a post short, exactly as switching
 * categories off can — so the label says what it does rather than selling it.
 */
const PHOTOS_OF_ME_OPTIONS: readonly { value: PhotosOfMe; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'prefer', label: 'Prefer' },
  { value: 'only', label: 'Only' },
];

const PHOTOS_OF_ME_HINT: Record<PhotosOfMe, string> = {
  off: 'Who is in a photo plays no part in what gets picked.',
  prefer: "Photos you're in come first. Others still fill the post when there aren't enough.",
  only: "Only photos you're in are suggested — so a post can come out short.",
};

export function AutoPostingSection({ bottomInset, onPreview }: Props): React.JSX.Element {
  const publisherId = usePublisherId();
  const config = useAutoPostingConfig(publisherId);
  const {
    frequency, photoCount, askBeforePost, notifyDayOfWeek, notifyTime, orderedCats, pushToken,
    photosOfMe, isLoading, buildConfig, setPushToken,
  } = config;
  // The profile photo is the only face "photos of me" matches against, so with
  // no avatar there is nothing to compare against and the control is hidden
  // rather than shown disabled — a switch that can't do anything is worse than
  // no switch. Setting an avatar makes it appear; the stored value is still
  // 'off' by default, so nothing starts happening on its own.
  const { profile } = useProfile(publisherId);
  const hasAvatar = (profile?.avatarUrl ?? null) != null;
  /** The settings as they stand — the one place they are turned into an entity. */
  const currentConfig = useMemo(() => buildConfig(), [buildConfig]);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [previewing, setPreviewing] = useState(false);
  // A category drag owns the vertical gesture; the scroll view must let go of it.
  const [dragging, setDragging] = useState(false);

  // What the server last acknowledged, and the lookback window the last photo
  // sync ran with. Both gate autosave's side effects — see `persistConfig`.
  const savedSnapshotRef = useRef<string | null>(null);
  const syncedLookbackRef = useRef<number | null>(null);
  /** A change is waiting on the debounce timer — flushed if the section unmounts. */
  const pendingRef = useRef(false);
  /** Whether this visit already refreshed the device's push token. */
  const tokenRegisteredRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // The first render after the stored config lands is the baseline: everything
  // on screen is exactly what the server holds, so nothing is owed a write.
  useEffect(() => {
    if (isLoading) return;
    savedSnapshotRef.current ??= snapshotOf(currentConfig);
    syncedLookbackRef.current ??= config.loadedLookbackDays;
  }, [isLoading, currentConfig, config.loadedLookbackDays]);

  /**
   * Write the settings as they stand. Every control calls this through the
   * debounce below — there is no Save button, so this is the only writer.
   */
  const persistConfig = useCallback(async (): Promise<void> => {
    // Both modes rely on the server pipeline (approval mode gets its batch
    // pushed by the server too), so the device has to be registered for push.
    // The old Save did this on every press; the first write of a visit does it
    // now, which keeps the OS permission prompt behind an actual change rather
    // than raising it just for opening the tab.
    let token = pushToken;
    if (!tokenRegisteredRef.current) {
      tokenRegisteredRef.current = true;
      token = (await registerPushToken().catch(() => null)) ?? pushToken;
      if (token !== pushToken && mountedRef.current) setPushToken(token);
    }
    const next = buildConfig(token);
    const snapshot = snapshotOf(next);
    pendingRef.current = false;
    if (mountedRef.current) setSaveState('saving');
    try {
      await saveConfig.execute(next);
      savedSnapshotRef.current = snapshot;

      // Deliberately no photo-upload consent prompt here. It used to hang off
      // Save, which at least was a press; a silent, debounced write is no place
      // to raise a privacy dialog, and after a cloud wipe — which withdraws
      // consent — re-asking because someone nudged a setting is exactly the
      // coupling that made the wipe feel undoable. Onboarding asks once, and
      // PhotoSyncStatus below carries the "upload is off / turn it on" state.

      // Only a changed lookback window needs photos re-synced, and that is the
      // one thing autosave must not do on every keystroke-sized edit: reordering
      // a category would otherwise kick a full upload pass. Everything else is
      // covered by the foreground sync in useAutoSync.
      //
      // Kicked off, not awaited: a first sync is minutes of uploads at three
      // photos at a time, and progress is visible in PhotoSyncStatus.
      if (next.lookbackDays !== syncedLookbackRef.current) {
        syncedLookbackRef.current = next.lookbackDays;
        if (await isPhotoSyncEnabled()) {
          void runCandidateSyncQuietly(publisherId, 'settings_sync_candidates', next.lookbackDays);
        }
      }
      if (next.expoPushToken !== '') {
        // Server owns the reminder — cancel the local one to avoid double-notifying.
        await scheduleReminder.cancel().catch(() => undefined);
      } else {
        // No push token (permissions denied / simulator) — local reminder fallback.
        await scheduleReminder.execute(next).catch(() => undefined);
      }
      if (mountedRef.current) setSaveState('saved');
    } catch {
      // With no Save button there is no button state to fail into, so say so.
      if (mountedRef.current) setSaveState('error');
    }
  }, [publisherId, pushToken, buildConfig, setPushToken]);

  // Stable handle on the latest `persistConfig`, so the timers below can fire
  // it without being torn down and rebuilt on every render.
  const persistRef = useRef(persistConfig);
  persistRef.current = persistConfig;

  // Autosave. Anything the publisher touches lands on its own after a beat —
  // the snapshot check means a re-render, a section switch or a reload never
  // writes on its own.
  useEffect(() => {
    if (isLoading || savedSnapshotRef.current == null) return;
    if (snapshotOf(currentConfig) === savedSnapshotRef.current) return;
    pendingRef.current = true;
    const timer = setTimeout(() => void persistRef.current(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [isLoading, currentConfig]);

  // Leaving the section (switching tabs, closing the app's Me page) must not
  // drop the change still sitting on the debounce timer. Defined after the
  // effect above so its clearTimeout runs first.
  useEffect(
    () => () => {
      if (pendingRef.current) void persistRef.current();
    },
    [],
  );

  function handlePreview(): void {
    void (async (): Promise<void> => {
      setPreviewing(true);
      try {
        // Flush whatever is still sitting on the autosave timer — the
        // suggestion run reads the stored config, not this screen's state.
        await persistRef.current();
        onPreview();
      } finally {
        setPreviewing(false);
      }
    })();
  }

  /** Turn photo sync back on (prompting for consent if needed) and start a run. */
  const handleEnableSync = useCallback((): void => {
    void (async (): Promise<void> => {
      if (!(await enablePhotoSync())) return;
      await runCandidateSyncQuietly(publisherId, 'settings_enable_sync');
    })();
  }, [publisherId]);

  /** Retry after a failed sync. Same call as every other trigger — nothing special. */
  const handleRetrySync = useCallback((): void => {
    void runCandidateSyncQuietly(publisherId, 'settings_retry_sync');
  }, [publisherId]);

  if (isLoading) {
    return <Text style={styles.loading}>Loading…</Text>;
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      scrollEnabled={!dragging}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
    >
      <Text style={styles.title}>Auto-posting</Text>

      <AutoPostingForm
        variant="card"
        frequency={frequency}
        notifyDayOfWeek={notifyDayOfWeek}
        notifyTime={notifyTime}
        askBeforePost={askBeforePost}
        onFrequency={config.setFrequency}
        onNotifyDayOfWeek={config.setNotifyDayOfWeek}
        onNotifyTime={config.setNotifyTime}
        onAskBeforePost={config.setAskBeforePost}
      >
        {/* Category list. Its drag state lives inside the list, so a touch-move
            re-renders nine rows rather than this whole section. */}
        <View style={formStyles.group}>
          <Text style={formStyles.groupLabel}>Photo categories</Text>
          <Text style={formStyles.hint}>Tap to enable · hold ≡ and drag to reorder</Text>
          <CategoryReorderList
            value={orderedCats}
            onChange={config.setOrderedCats}
            onDraggingChange={setDragging}
          />
        </View>

        {/* Photos per post */}
        <View style={formStyles.group}>
          <Text style={formStyles.groupLabel}>Photos per post</Text>
          <View style={formStyles.options}>
            {([5, 10, 15] as PhotoCount[]).map(n => (
              <TouchableOpacity
                key={n}
                testID={`auto-count-${n}`}
                style={[formStyles.option, photoCount === n && formStyles.optionActive]}
                onPress={() => config.setPhotoCount(n)}
              >
                <Text style={[formStyles.optionText, photoCount === n && formStyles.optionTextActive]}>
                  {n}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Photos of me (issue #137). Hidden outright without a profile photo —
            see hasAvatar. The hint names the profile photo explicitly, because
            comparing faces against it is not something the publisher would
            otherwise know we do. */}
        {hasAvatar && (
          <View style={formStyles.group}>
            <Text style={formStyles.groupLabel}>Photos of me</Text>
            <Text style={formStyles.hint}>
              We compare each photo with your profile photo to spot the ones you&apos;re in.
              Nothing about your face is saved.
            </Text>
            <View style={formStyles.options}>
              {PHOTOS_OF_ME_OPTIONS.map(({ value, label }) => (
                <TouchableOpacity
                  key={value}
                  testID={`auto-photos-of-me-${value}`}
                  style={[formStyles.option, photosOfMe === value && formStyles.optionActive]}
                  onPress={() => config.setPhotosOfMe(value)}
                >
                  <Text
                    style={[
                      formStyles.optionText,
                      photosOfMe === value && formStyles.optionTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.photosOfMeNote}>{PHOTOS_OF_ME_HINT[photosOfMe]}</Text>
          </View>
        )}
      </AutoPostingForm>

      {/* What photo sync is doing right now. Always shown: "nothing is
          happening and nothing will" is exactly the state that used to be
          invisible, and it is the one the user has to act on. */}
      <PhotoSyncStatus onEnable={handleEnableSync} onRetry={handleRetrySync} />

      {/* No Save button — every control above writes itself. This line is the
          only feedback that there was ever a write to wait for, so it has to
          name a failure as well as a success. */}
      <View style={styles.saveStatusRow}>
        {saveState === 'saving' && <ActivityIndicator size="small" color={colors.textMuted} />}
        {saveState === 'saved' && <Ionicons name="checkmark-circle" size={14} color={colors.success} />}
        {saveState === 'error' && <Ionicons name="alert-circle" size={14} color={colors.danger} />}
        <Text
          testID="auto-save-status"
          style={[styles.saveStatusText, saveState === 'error' && styles.saveStatusError]}
        >
          {saveState === 'saving'
            ? 'Saving…'
            : saveState === 'saved'
            ? 'Saved'
            : saveState === 'error'
            ? "Couldn't save — check your connection"
            : 'Changes are saved automatically'}
        </Text>
      </View>

      <TouchableOpacity
        testID="auto-preview"
        style={[styles.previewButton, previewing && styles.buttonDisabled]}
        onPress={handlePreview}
        activeOpacity={0.85}
        disabled={previewing}
      >
        <Text style={styles.previewText}>{previewing ? 'Saving…' : 'Preview suggestion now'}</Text>
      </TouchableOpacity>

      {/* Absent from a production bundle entirely — metro.config.js resolves
          this import to a stub that renders null. */}
      <DevNotificationPanel publisherId={publisherId} config={currentConfig} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, gap: spacing.md },
  loading: { ...typography.caption, color: colors.textSecondary, padding: spacing.xl },
  title: { ...typography.heading, fontSize: 16, color: colors.text, marginBottom: spacing.xs },
  buttonDisabled: { opacity: 0.6 },
  // Sits *below* the choices, unlike the hint above them: it describes the
  // option currently selected, so it changes as the publisher taps.
  photosOfMeNote: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: spacing.sm,
    lineHeight: 15,
  },
  // Autosave feedback, in place of the old Save button.
  saveStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 18,
    marginTop: spacing.xs,
  },
  saveStatusText: { ...typography.caption, fontSize: 12, color: colors.textMuted },
  saveStatusError: { color: colors.danger },
  previewButton: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewText: { color: colors.ink, fontWeight: '600', fontSize: 13 },
});
