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
import type { PhotoCount } from '../../../domain/entities/PublisherConfig';
import { isPhotoSyncEnabled } from '../../data/photoSyncConsent';
import { runCandidateSyncQuietly } from '../../data/candidateSync';
import { useConnectionStatus } from '../../data/connectivity';
import { isUsable } from '../../../domain/services/connectivityCopy';
import { describeFailure } from '../../../domain/services/networkError';
import type { ConnectionStatus } from '../../../domain/entities/Connectivity';
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
 * The autosave row's failure line. Offline is stated as a hold rather than a
 * loss — the change is still on screen and still going to be written — while
 * anything else borrows the same wording the rest of the app uses.
 */
function saveStatusFailure(error: unknown, connection: ConnectionStatus): string {
  if (!isUsable(connection)) return 'Not saved yet — you’re offline. This saves itself when you’re back.';
  return describeFailure({ error, connection, title: '' }).hint;
}

export function AutoPostingSection({ bottomInset, onPreview }: Props): React.JSX.Element {
  const publisherId = usePublisherId();
  const config = useAutoPostingConfig(publisherId);
  const {
    frequency, photoCount, askBeforePost, notifyDayOfWeek, notifyTime, orderedCats, pushToken,
    isLoading, buildConfig, setPushToken,
  } = config;
  /** The settings as they stand — the one place they are turned into an entity. */
  const currentConfig = useMemo(() => buildConfig(), [buildConfig]);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  // The failure itself, so the status line can say whether it was the
  // connection or the server. `null` while the failure is simply "offline",
  // which the app knows without having tried (issue #145).
  const [saveError, setSaveError] = useState<unknown>(null);
  const connection = useConnectionStatus();
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
    // Offline: don't spend a timeout finding out. These settings are the one
    // write worth holding rather than refusing — the config is rebuilt from
    // what is on screen at the moment it is sent, so writing it later writes
    // what the publisher actually wants, not a stale snapshot. What must not
    // happen is it looking saved, so the row below says so until it lands.
    if (!isUsable(connection)) {
      pendingRef.current = true;
      if (mountedRef.current) {
        setSaveError(null);
        setSaveState('error');
      }
      return;
    }
    pendingRef.current = false;
    if (mountedRef.current) setSaveState('saving');
    try {
      await saveConfig.execute(next);
      savedSnapshotRef.current = snapshot;

      // Deliberately nothing about photo-upload consent here. It used to hang
      // off Save, which at least was a press; a silent, debounced write is no
      // place to change a privacy setting, and after a cloud wipe — which
      // switches upload off — flipping it back because someone nudged a
      // setting is exactly the coupling that made the wipe feel undoable.
      // Upload is on by default and its switch is in Settings → Privacy;
      // PhotoSyncStatus below only reports when it is off.

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
      if (mountedRef.current) {
        setSaveError(null);
        setSaveState('saved');
      }
    } catch (e: unknown) {
      // With no Save button there is no button state to fail into, so say so.
      if (mountedRef.current) {
        setSaveError(e);
        setSaveState('error');
      }
      // Left pending so the reconnect effect picks it up.
      pendingRef.current = true;
    }
  }, [publisherId, pushToken, buildConfig, setPushToken, connection]);

  // Stable handle on the latest `persistConfig`, so the timers below can fire
  // it without being torn down and rebuilt on every render.
  const persistRef = useRef(persistConfig);
  persistRef.current = persistConfig;

  // Back online with something still unsaved — write it now, without the
  // publisher having to remember which switch never took.
  useEffect(() => {
    if (!isUsable(connection) || !pendingRef.current) return;
    void persistRef.current();
  }, [connection]);

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
      </AutoPostingForm>

      {/* What photo sync is doing right now — reported, not offered. "Nothing is
          happening and nothing will" is exactly the state that used to be
          invisible; the switch that produces it lives in Settings → Privacy. */}
      <PhotoSyncStatus onRetry={handleRetrySync} />

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
            ? saveStatusFailure(saveError, connection)
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
