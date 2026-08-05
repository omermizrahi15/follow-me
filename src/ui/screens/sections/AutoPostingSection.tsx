import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePublisherId } from '../../context/AuthContext';
import * as FileSystem from 'expo-file-system/legacy';
import {
  saveConfig,
  loadConfig,
  scheduleReminder,
  syncCandidatePhotos,
  registerPushToken,
  deviceTimezone,
  scheduleTestNotification,
  recentCandidateUrls,
  candidateUrlsByAssetIds,
  saveTestApprovalBatch,
  deleteUploadedPhotos,
  SuggestionCache,
} from '../../../composition/container';
import { PublisherConfig, FREQUENCY_DAYS } from '../../../domain/entities/PublisherConfig';
import type { Frequency, PhotoCount } from '../../../domain/entities/PublisherConfig';
import { isWeekdayCadence } from '../../../domain/services/autoPostSchedule';
import { assetIdsNeedingLookup, resolveChosenGalleryUrls } from '../../../domain/services/notificationGallery';
import {
  confirmPhotoSync,
  enablePhotoSync,
  hasPhotoSyncConsent,
  isPhotoSyncEnabled,
  pausePhotoSync,
} from '../../data/photoSyncConsent';
import { runCandidateSyncQuietly } from '../../data/candidateSync';
import { PhotoSyncStatus } from './PhotoSyncStatus';
import { showDevTools } from '../../data/devTools';
import { SELECTABLE_CATEGORIES } from '../../../domain/entities/PhotoClassification';
import type { PhotoCategory } from '../../../domain/entities/PhotoClassification';
import { colors, radius, spacing, typography } from '../../theme/theme';

interface Props {
  bottomInset: number;
  onSaved: () => void;
  onPreview: () => void;
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const TIME_PRESETS = ['08:00', '12:00', '18:00', '21:00'];
const FREQ_OPTIONS: { value: Frequency; label: string }[] = [
  { value: '3days', label: '3 days' },
  { value: 'weekly', label: '1 week' },
  { value: 'biweekly', label: '2 weeks' },
  { value: 'monthly', label: '30 days' },
];
const CATEGORY_LABELS: Record<PhotoCategory, string> = {
  selfie_with_view: 'People + view',
  sunset_sunrise: 'Sunset / sunrise',
  architecture: 'Architecture',
  selfie_with_people: 'People',
  food: 'Food & drinks',
  nature: 'Nature',
  night_scene: 'Night scene',
  cultural: 'Cultural',
  other: 'Other',
};

type OrderedCategory = { cat: PhotoCategory; enabled: boolean };

/** Row height in the category list — must match catRow style. */
const ITEM_H = 48;

// DEV-only fallback for the ⚡ test buttons: when the publisher has no synced or
// cached photos (fresh install, empty cloud, simulator), these public sample
// images + place let the test notification still exercise the full rich push —
// collapsed thumbnail, expandable gallery, and a location in the title.
const SAMPLE_GALLERY = [
  'https://picsum.photos/seed/followme1/800/800',
  'https://picsum.photos/seed/followme2/800/800',
  'https://picsum.photos/seed/followme3/800/800',
  'https://picsum.photos/seed/followme4/800/800',
  'https://picsum.photos/seed/followme5/800/800',
];
const SAMPLE_PLACE = 'Tel Aviv, Israel';

function buildOrderedList(enabledInOrder: PhotoCategory[]): OrderedCategory[] {
  const enabledSet = new Set(enabledInOrder);
  return [
    ...enabledInOrder.map(cat => ({ cat, enabled: true })),
    ...SELECTABLE_CATEGORIES.filter(c => !enabledSet.has(c)).map(cat => ({ cat, enabled: false })),
  ];
}

export function AutoPostingSection({ bottomInset, onSaved, onPreview }: Props): React.JSX.Element {
  const publisherId = usePublisherId();
  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [photoCount, setPhotoCount] = useState<PhotoCount>(10);
  const [askBeforePost, setAskBeforePost] = useState(true);
  const [notifyDayOfWeek, setNotifyDayOfWeek] = useState(0);
  const [notifyTime, setNotifyTime] = useState('18:00');
  const [orderedCats, setOrderedCats] = useState<OrderedCategory[]>(() =>
    SELECTABLE_CATEGORIES.map(cat => ({ cat, enabled: true })),
  );
  const [pushToken, setPushToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [testScheduling, setTestScheduling] = useState(false);
  const [testScheduledAt, setTestScheduledAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Whether the publisher has any photos in the cloud — gates the "Remove my
  // photos from the cloud" affordance so it only shows when there's something to
  // remove (otherwise it lingered permanently, even with an empty cloud).
  const [hasCloudPhotos, setHasCloudPhotos] = useState(false);

  // Drag state
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragDy, setDragDy] = useState(0);
  const dragRef = useRef<{ startY: number } | null>(null);
  // Stable ref so drag handlers always see the latest list without recreating themselves
  const orderedCatsRef = useRef(orderedCats);
  orderedCatsRef.current = orderedCats;

  const isDragging = dragFrom !== null;

  // Compute where the dragged item would land, clamped to its section.
  const dragTo: number | null = (() => {
    if (dragFrom === null) return null;
    const cats = orderedCatsRef.current;
    const item = cats[dragFrom];
    if (!item) return null;
    const lastEnabled = cats.reduce<number>((acc, c, i) => (c.enabled ? i : acc), -1);
    const firstDisabled = cats.findIndex(c => !c.enabled);
    let raw = Math.round(dragFrom + dragDy / ITEM_H);
    if (item.enabled) {
      raw = Math.min(raw, lastEnabled);
    } else if (firstDisabled !== -1) {
      raw = Math.max(raw, firstDisabled);
    }
    return Math.max(0, Math.min(cats.length - 1, raw));
  })();

  function getDragTranslateY(i: number): number {
    if (dragFrom === null || dragTo === null) return 0;
    if (i === dragFrom) return dragDy;
    if (dragFrom < dragTo && i > dragFrom && i <= dragTo) return -ITEM_H;
    if (dragFrom > dragTo && i >= dragTo && i < dragFrom) return ITEM_H;
    return 0;
  }

  interface DragHandlers {
    onStartShouldSetResponder: () => boolean;
    onResponderGrant: (e: GestureResponderEvent) => void;
    onResponderMove: (e: GestureResponderEvent) => void;
    onResponderRelease: (e: GestureResponderEvent) => void;
    onResponderTerminate: () => void;
  }

  function makeDragHandlers(i: number): DragHandlers {
    return {
      onStartShouldSetResponder: () => true,
      onResponderGrant: (e: GestureResponderEvent) => {
        dragRef.current = { startY: e.nativeEvent.pageY };
        setDragFrom(i);
        setDragDy(0);
      },
      onResponderMove: (e: GestureResponderEvent) => {
        if (!dragRef.current) return;
        setDragDy(e.nativeEvent.pageY - dragRef.current.startY);
      },
      onResponderRelease: (e: GestureResponderEvent) => {
        if (!dragRef.current) return;
        const dy = e.nativeEvent.pageY - dragRef.current.startY;
        commitDrag(i, dy);
        dragRef.current = null;
        setDragFrom(null);
        setDragDy(0);
      },
      onResponderTerminate: () => {
        dragRef.current = null;
        setDragFrom(null);
        setDragDy(0);
      },
    };
  }

  function commitDrag(from: number, dy: number): void {
    setOrderedCats(prev => {
      const item = prev[from];
      if (!item) return prev;
      const lastEnabled = prev.reduce<number>((acc, c, i) => (c.enabled ? i : acc), -1);
      const firstDisabled = prev.findIndex(c => !c.enabled);
      let raw = Math.round(from + dy / ITEM_H);
      if (item.enabled) {
        raw = Math.min(raw, lastEnabled);
      } else if (firstDisabled !== -1) {
        raw = Math.max(raw, firstDisabled);
      }
      const to = Math.max(0, Math.min(prev.length - 1, raw));
      if (to === from) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (moved == null) return prev;
      next.splice(to, 0, moved);
      return next;
    });
  }

  /**
   * Toggle enabled/disabled. Always keeps enabled items above disabled:
   * – enabling  → moves item to just after the last enabled item
   * – disabling → moves item to just after the new last enabled item
   * Either way: insertAt = lastEnabledInRemainder + 1.
   */
  function toggleCat(index: number): void {
    setOrderedCats(prev => {
      const item = prev[index];
      if (!item) return prev;
      const without = [...prev];
      without.splice(index, 1);
      const lastEnabled = without.reduce<number>((acc, c, i) => (c.enabled ? i : acc), -1);
      const insertAt = lastEnabled + 1;
      without.splice(insertAt, 0, { ...item, enabled: !item.enabled });
      return without;
    });
  }

  // Refresh whether the cloud holds any of this publisher's photos (one row is
  // enough to know). Best-effort: on a network/lookup failure, hide the removal
  // affordance rather than show it with nothing behind it.
  const refreshHasCloudPhotos = React.useCallback(async (): Promise<void> => {
    try {
      const urls = await recentCandidateUrls(publisherId, 1);
      setHasCloudPhotos(urls.length > 0);
    } catch {
      setHasCloudPhotos(false);
    }
  }, [publisherId]);

  useEffect(() => {
    void loadConfig.execute(publisherId).then(config => {
      setFrequency(config.frequency);
      setPhotoCount(config.photosPerPost);
      setAskBeforePost(config.requireApproval);
      setNotifyDayOfWeek(config.notifyDayOfWeek);
      setNotifyTime(config.notifyTime);
      setOrderedCats(buildOrderedList(config.enabledCategories));
      setPushToken(config.expoPushToken);
      setIsLoading(false);
    });
    void refreshHasCloudPhotos();
  }, [publisherId, refreshHasCloudPhotos]);

  function buildCurrentConfig(token: string): PublisherConfig {
    const enabledCategories = orderedCats.filter(c => c.enabled).map(c => c.cat);
    return PublisherConfig.create({
      publisherId,
      frequency,
      photosPerPost: photoCount,
      requireApproval: askBeforePost,
      notifyDayOfWeek,
      notifyTime,
      enabledCategories: enabledCategories.length > 0 ? enabledCategories : [...SELECTABLE_CATEGORIES],
      timezone: deviceTimezone(),
      expoPushToken: token,
    });
  }

  function handleSave(): void {
    void (async (): Promise<void> => {
      setSaving(true);
      try {
        // Both modes rely on the server pipeline (approval mode gets its batch
        // pushed by the server too), so always register the push token and keep
        // recent photos synced to the cloud.
        const token = (await registerPushToken().catch(() => null)) ?? pushToken;
        setPushToken(token);
        const config = buildCurrentConfig(token);
        await saveConfig.execute(config);

        // First run only: setting up auto-posting is the natural moment to ask
        // for photo upload. Saving does NOT lift a pause, though — that was the
        // hidden coupling behind a week of silently-off sync, where the only way
        // back was a button nobody could know to press. Turning upload back on
        // is now its own visible action in PhotoSyncStatus.
        if (!(await hasPhotoSyncConsent())) await confirmPhotoSync();

        // Kicked off, not awaited. A lookback change should take effect now, but
        // a first sync is minutes of uploads at three photos at a time and the
        // save itself finished a second ago — blocking the button on the backlog
        // made a working sync look like a hang (and get force-quit halfway).
        // Progress is visible in PhotoSyncStatus instead.
        if (await isPhotoSyncEnabled()) {
          void runCandidateSyncQuietly(
            publisherId,
            'settings_sync_candidates',
            config.lookbackDays,
          ).then(refreshHasCloudPhotos);
        }
        if (token !== '') {
          // Server owns the reminder — cancel the local one to avoid double-notifying.
          await scheduleReminder.cancel().catch(() => undefined);
        } else {
          // No push token (permissions denied / simulator) — local reminder fallback.
          await scheduleReminder.execute(config).catch(() => undefined);
        }
        onSaved();
      } finally {
        setSaving(false);
      }
    })();
  }

  function handlePreview(): void {
    void (async (): Promise<void> => {
      setPreviewing(true);
      try {
        const config = buildCurrentConfig(pushToken);
        await saveConfig.execute(config).catch(() => undefined);
        onPreview();
      } finally {
        setPreviewing(false);
      }
    })();
  }

  async function fireTestNotification(seconds: number): Promise<void> {
    setTestScheduling(true);
    const log: string[] = [];
    try {
      const config = buildCurrentConfig(pushToken);
      await saveConfig.execute(config).catch(() => undefined);

      const want = config.photosPerPost > 0 ? config.photosPerPost : 5;
      const localUris: string[] = [];
      // Remote (https) source URLs — passed as `gallery` so the notification
      // content extension renders the same expandable grid as the real push.
      const galleryUrls: string[] = [];
      // Whether the notification shows the real selection — surfaced to the tester,
      // because a test push quietly built from unrelated photos is worse than none.
      let usedChosenBatch = false;
      let missingFromBatch = 0;
      // The photos behind `galleryUrls`, with their asset ids. Only the chosen
      // batch supplies them, and only they can be persisted server-side — which
      // is what makes the test push's "Post now" exercise the real background
      // post instead of falling back to "open the app".
      let postablePhotos: { id: string; url: string }[] = [];
      log.push(`want: ${want} photos`);

      // 1. Show the photos the review screen actually chose. A device-scanned batch
      // stores ph:// asset uris, which neither FileSystem nor the notification
      // extensions can read — but the same photo's uploaded copy is in
      // candidate_photos under the same asset id, so resolve it rather than
      // discarding the choice and backfilling with unrelated photos (issue #85).
      const cached = await SuggestionCache.load(publisherId).catch(() => null);
      if (cached == null) {
        log.push('cache: empty');
      } else {
        const needLookup = assetIdsNeedingLookup(cached.batch);
        const cloudUrls = needLookup.length > 0
          ? await candidateUrlsByAssetIds(publisherId, needLookup).catch((e: unknown) => {
              log.push(`cloud lookup failed: ${e instanceof Error ? e.message : String(e)}`);
              return new Map<string, string>();
            })
          : new Map<string, string>();
        const resolved = resolveChosenGalleryUrls(cached.batch, cloudUrls, want);
        log.push(
          `cache: ${cached.batch.length} chosen, ${needLookup.length} needed lookup, ` +
            `${resolved.urls.length} resolved, ${resolved.missing.length} not yet uploaded`,
        );
        usedChosenBatch = resolved.urls.length > 0;
        missingFromBatch = resolved.missing.length;
        galleryUrls.push(...resolved.urls);
        postablePhotos = resolved.photos;
        const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
        const downloads = await Promise.allSettled(
          resolved.urls.map(async (url, i) => {
            const dest = `${dir}dev-notif-${i}.jpg`;
            try {
              const dl = await FileSystem.downloadAsync(url, dest);
              return dl.status === 200 ? dl.uri : null;
            } catch (e) {
              log.push(`dl[${i}] error: ${e instanceof Error ? e.message : String(e)}`);
              return null;
            }
          }),
        );
        let cacheHits = 0;
        for (const r of downloads) {
          if (r.status === 'fulfilled' && r.value != null) { localUris.push(r.value); cacheHits++; }
          else if (r.status === 'rejected') log.push(`dl rejected: ${String(r.reason)}`);
        }
        log.push(`cache downloaded: ${cacheHits}`);
      }

      // 2. Only when the chosen batch yielded nothing at all, fall back to recent
      // cloud-synced candidates. This is NOT the chosen batch — it's unfiltered
      // "most recently synced" — so it is surfaced to the tester below rather than
      // silently passed off as the real selection. Gate on `galleryUrls`, not on
      // download success: a failed thumbnail download still means we had the right
      // photos, and mixing the two sources produced duplicate/foreign photos before.
      if (galleryUrls.length === 0) {
        try {
          let urls = await recentCandidateUrls(publisherId, want);
          log.push(`candidate urls: ${urls.length}`);
          if (urls.length === 0) {
            // Nothing synced yet — run the sync now. Uses the use case directly
            // rather than runCandidateSync: this diagnostic wants the upload
            // count and the error text in its own log, not a Sentry report.
            log.push('running photo sync…');
            try {
              const synced = await syncCandidatePhotos.execute(publisherId, config.lookbackDays);
              log.push(`sync uploaded: ${synced.length}`);
            } catch (syncErr) {
              log.push(`sync FAILED: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`);
            }
            urls = await recentCandidateUrls(publisherId, want);
            log.push(`candidate urls now: ${urls.length}`);
          }
          galleryUrls.push(...urls);
          const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
          const downloads = await Promise.allSettled(
            urls.map(async (url, i) => {
              const dl = await FileSystem.downloadAsync(url, `${dir}cand-notif-${i}.jpg`);
              return dl.status === 200 ? dl.uri : null;
            }),
          );
          let candHits = 0;
          for (const r of downloads) {
            if (r.status === 'fulfilled' && r.value != null) { localUris.push(r.value); candHits++; }
          }
          log.push(`candidates downloaded: ${candHits}`);
        } catch (e) {
          log.push(`candidates error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // No real photos available (empty cloud / fresh install / simulator) — fall
      // back to built-in samples so the test still shows the full rich push.
      let place: string | null = null;
      if (galleryUrls.length === 0) {
        log.push('no photos available — using sample gallery + place');
        galleryUrls.push(...SAMPLE_GALLERY);
        place = SAMPLE_PLACE;
        const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
        const dl = await Promise.allSettled(
          SAMPLE_GALLERY.slice(0, 3).map(async (url, i) => {
            const r = await FileSystem.downloadAsync(url, `${dir}sample-notif-${i}.jpg`);
            return r.status === 200 ? r.uri : null;
          }),
        );
        for (const r of dl) if (r.status === 'fulfilled' && r.value != null) localUris.push(r.value);
        log.push(`sample thumbnails downloaded: ${localUris.length}`);
      }

      log.push(`total attached: ${localUris.length}, gallery urls: ${galleryUrls.length}`);
      if (localUris[0]) log.push(`first URI: ${localUris[0].slice(0, 60)}`);

      // Persist the batch so "Post now" on this test push publishes for real,
      // in the background, exactly as it will from the server's approval push.
      // Best-effort: a failure just means the button asks for the app instead.
      let batchId: string | undefined;
      if (postablePhotos.length > 0) {
        try {
          batchId = await saveTestApprovalBatch(publisherId, postablePhotos);
          log.push(`postable batch saved: ${batchId}`);
        } catch (e) {
          log.push(`batch save failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        log.push('no postable batch — "Post now" will ask to open the app');
      }

      await scheduleTestNotification(seconds, localUris, galleryUrls, place, batchId);
      setTestScheduledAt(seconds >= 60 ? new Date(Date.now() + seconds * 1000) : null);
      console.log(`[DEV] ⚡ ${seconds}s notification\n${log.join('\n')}`);

      // Tell the tester what they're about to see. Without this, a push built from
      // stand-in photos is indistinguishable from a correct one, which is how #85
      // survived: the fallback only ever announced itself to the console.
      if (!usedChosenBatch) {
        Alert.alert(
          'Test uses stand-in photos',
          `No reviewed batch was available, so this notification shows ${
            place != null ? 'built-in samples' : 'your most recently synced photos'
          } — not an AI-picked selection. Open the review screen first to test the real batch.`,
        );
      } else if (missingFromBatch > 0) {
        Alert.alert(
          'Some chosen photos are missing',
          `${missingFromBatch} of the reviewed photos haven't been uploaded to the cloud yet, so they can't appear in a notification. Showing the ${galleryUrls.length} that have.`,
        );
      }
    } catch (e) {
      log.push(`FATAL: ${e instanceof Error ? e.message : String(e)}`);
      console.warn(`[DEV] ⚡ error\n${log.join('\n')}`);
    } finally {
      setTestScheduling(false);
    }
  }

  /** Turn photo sync back on (prompting for consent if needed) and start a run. */
  function handleEnableSync(): void {
    void (async (): Promise<void> => {
      if (!(await enablePhotoSync())) return;
      await runCandidateSyncQuietly(publisherId, 'settings_enable_sync');
      void refreshHasCloudPhotos();
    })();
  }

  /** Retry after a failed sync. Same call as every other trigger — nothing special. */
  function handleRetrySync(): void {
    void (async (): Promise<void> => {
      await runCandidateSyncQuietly(publisherId, 'settings_retry_sync');
      void refreshHasCloudPhotos();
    })();
  }

  function handleDeleteUploaded(): void {
    Alert.alert(
      'Remove your photos from the cloud?',
      'This deletes every private copy the app has uploaded for auto-posting, and switches photo upload off. Photos on your phone and posts already sent are untouched. You can turn upload back on any time from the photo status above.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async (): Promise<void> => {
              try {
                const { deletedRows } = await deleteUploadedPhotos();
                // Suspend background auto-sync so the next foreground doesn't
                // silently re-upload what we just deleted — it stays gone until
                // the user opts back in by saving (matches the dialog copy).
                await pausePhotoSync();
                // Cloud is now empty — hide the removal affordance until a re-sync.
                setHasCloudPhotos(false);
                Alert.alert('Deleted', `${deletedRows} uploaded photo${deletedRows === 1 ? '' : 's'} removed.`);
              } catch (e) {
                Alert.alert('Delete failed', e instanceof Error ? e.message : 'Something went wrong');
              }
            })();
          },
        },
      ],
    );
  }

  function handleTestNotification(): void {
    void fireTestNotification(120);
  }

  function handleTestNow(): void {
    void fireTestNotification(5);
  }

  if (isLoading) {
    return <Text style={styles.loading}>Loading…</Text>;
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      scrollEnabled={!isDragging}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
    >
      <Text style={styles.title}>Auto-posting</Text>

      {/* Frequency (= lookback window) */}
      <View style={styles.group}>
        <Text style={styles.groupLabel}>Post every</Text>
        <View style={styles.options}>
          {FREQ_OPTIONS.map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              testID={`auto-freq-${value}`}
              style={[styles.option, frequency === value && styles.optionActive]}
              onPress={() => setFrequency(value)}
            >
              <Text style={[styles.optionText, frequency === value && styles.optionTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Schedule. Weekly cadences pick a weekday; day-count cadences (every
          3/30 days) have no natural weekday — the next slot is shown instead. */}
      <View style={styles.group}>
        {isWeekdayCadence(FREQUENCY_DAYS[frequency]) ? (
          <>
            <Text style={styles.groupLabel}>Reminder day</Text>
            <View style={styles.options}>
              {DAY_LABELS.map((label, day) => (
                <TouchableOpacity
                  key={day}
                  testID={`auto-day-${day}`}
                  style={[styles.dayOption, notifyDayOfWeek === day && styles.optionActive]}
                  onPress={() => setNotifyDayOfWeek(day)}
                >
                  <Text style={[styles.optionText, notifyDayOfWeek === day && styles.optionTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.groupLabel, styles.spacer]}>Reminder time</Text>
          </>
        ) : (
          <>
            <Text style={styles.groupLabel}>Reminder day</Text>
            <Text style={styles.intervalNote} testID="auto-interval-note">
              Every {FREQUENCY_DAYS[frequency]} days there’s no fixed weekday — the next one lands
              by{' '}
              {new Date(Date.now() + FREQUENCY_DAYS[frequency] * 24 * 60 * 60 * 1000).toLocaleDateString([], {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
              , then every {FREQUENCY_DAYS[frequency]} days after each post.
            </Text>
            <Text style={[styles.groupLabel, styles.spacer]}>Reminder time</Text>
          </>
        )}
        <View style={styles.options}>
          {TIME_PRESETS.map(t => (
            <TouchableOpacity
              key={t}
              testID={`auto-time-${t}`}
              style={[styles.option, notifyTime === t && styles.optionActive]}
              onPress={() => setNotifyTime(t)}
            >
              <Text style={[styles.optionText, notifyTime === t && styles.optionTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Category list */}
      <View style={styles.group}>
        <Text style={styles.groupLabel}>Photo categories</Text>
        <Text style={styles.hint}>Tap to enable · hold ≡ and drag to reorder</Text>
        {orderedCats.map(({ cat, enabled }, i) => {
          const translateY = getDragTranslateY(i);
          const isGhost = i === dragFrom;
          return (
            <View
              key={cat}
              style={[
                styles.catRow,
                isGhost && styles.catRowGhost,
                { transform: [{ translateY }], zIndex: isGhost ? 10 : 1 },
              ]}
            >
              <TouchableOpacity
                onPress={() => !isDragging && toggleCat(i)}
                style={styles.catCheck}
                activeOpacity={0.7}
                hitSlop={4}
              >
                <View style={[styles.checkbox, enabled && styles.checkboxActive]}>
                  {enabled && <Ionicons name="checkmark" size={12} color="#fff" />}
                </View>
              </TouchableOpacity>
              <Text style={[styles.catLabel, !enabled && styles.catLabelOff]} numberOfLines={1}>
                {CATEGORY_LABELS[cat]}
              </Text>
              {/* Drag handle — capturing responder here, not on the row */}
              <View style={styles.dragHandle} {...makeDragHandlers(i)}>
                <Ionicons name="menu" size={18} color={enabled ? colors.textSecondary : colors.border} />
              </View>
            </View>
          );
        })}
      </View>

      {/* Photos per post */}
      <View style={styles.group}>
        <Text style={styles.groupLabel}>Photos per post</Text>
        <View style={styles.options}>
          {([5, 10, 15] as PhotoCount[]).map(n => (
            <TouchableOpacity
              key={n}
              testID={`auto-count-${n}`}
              style={[styles.option, photoCount === n && styles.optionActive]}
              onPress={() => setPhotoCount(n)}
            >
              <Text style={[styles.optionText, photoCount === n && styles.optionTextActive]}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Approval toggle */}
      <View style={[styles.group, styles.toggleRow]}>
        <View style={styles.toggleText}>
          <Text style={styles.groupLabel}>Ask before posting</Text>
          <Text style={styles.hint}>
            {askBeforePost
              ? 'Approve each post before it goes out'
              : 'Posts go out automatically — recent photos are uploaded so we can post even when the app is closed'}
          </Text>
        </View>
        <Switch
          testID="auto-approval-toggle"
          value={askBeforePost}
          onValueChange={setAskBeforePost}
          trackColor={{ false: colors.border, true: colors.success }}
          thumbColor={colors.surface}
          ios_backgroundColor={colors.border}
        />
      </View>

      {/* What photo sync is doing right now. Always shown: "nothing is
          happening and nothing will" is exactly the state that used to be
          invisible, and it is the one the user has to act on. */}
      <PhotoSyncStatus onEnable={handleEnableSync} onRetry={handleRetrySync} />

      {/* Privacy: user-initiated wipe of the cloud photo pool. Only shown when
          there's actually something in the cloud to remove. */}
      {hasCloudPhotos && (
        <View style={styles.deleteUploadedBlock}>
          <TouchableOpacity testID="auto-remove-cloud-photos" onPress={handleDeleteUploaded} hitSlop={8}>
            <Text style={styles.deleteUploadedLink}>Remove my photos from the cloud</Text>
          </TouchableOpacity>
          <Text style={styles.deleteUploadedHint}>
            Auto-posting keeps private copies of your recent photos in the cloud so it can post while
            the app is closed. This deletes those copies — photos on your phone and posts already sent
            are not affected.
          </Text>
        </View>
      )}

      <TouchableOpacity
        testID="auto-save"
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        activeOpacity={0.85}
        disabled={saving}
      >
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        testID="auto-preview"
        style={[styles.previewButton, previewing && styles.saveButtonDisabled]}
        onPress={handlePreview}
        activeOpacity={0.85}
        disabled={previewing}
      >
        <Text style={styles.previewText}>{previewing ? 'Saving…' : 'Preview suggestion now'}</Text>
      </TouchableOpacity>


      {showDevTools && (
        <View style={styles.devRow}>
          <TouchableOpacity
            style={[styles.devButton, styles.devButtonFull, testScheduling && styles.saveButtonDisabled]}
            onPress={handleTestNow}
            activeOpacity={0.85}
            disabled={testScheduling}
          >
            <Text style={styles.devText}>{testScheduling ? '…' : '⚡ Now'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.devButton, styles.devButtonFull, testScheduling && styles.saveButtonDisabled]}
            onPress={handleTestNotification}
            activeOpacity={0.85}
            disabled={testScheduling}
          >
            <Text style={styles.devText}>
              {testScheduling
                ? '…'
                : testScheduledAt != null
                ? `⚡ At ${testScheduledAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : '⚡ In 2 min'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, gap: spacing.md },
  loading: { ...typography.caption, color: colors.textSecondary, padding: spacing.xl },
  title: { ...typography.heading, fontSize: 16, color: colors.text, marginBottom: spacing.xs },
  group: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    overflow: 'visible',
  },
  groupLabel: { ...typography.caption, fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  spacer: { marginTop: spacing.md },
  intervalNote: { ...typography.caption, fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  hint: { ...typography.caption, fontSize: 11, color: colors.textMuted, marginBottom: spacing.sm },
  options: { flexDirection: 'row', gap: spacing.xs },
  option: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayOption: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  optionText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  optionTextActive: { color: '#fff' },
  // Category list
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ITEM_H,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
  },
  catRowGhost: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  catCheck: { paddingLeft: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  catLabel: { flex: 1, fontSize: 13, fontWeight: '500', color: colors.text },
  catLabelOff: { color: colors.textMuted },
  dragHandle: {
    padding: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Approval
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleText: { flex: 1, marginRight: spacing.md },
  saveButton: {
    backgroundColor: colors.ink,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  previewButton: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewText: { color: colors.ink, fontWeight: '600', fontSize: 13 },
  devRow: { flexDirection: 'row', gap: spacing.xs },
  devButton: {
    backgroundColor: '#1a1a2e',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4a4a8a',
  },
  devButtonFull: { flex: 1 },
  deleteUploadedBlock: { gap: spacing.xs },
  deleteUploadedLink: {
    ...typography.caption,
    fontSize: 12,
    color: colors.danger,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  deleteUploadedHint: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  devText: { color: '#a0a0ff', fontWeight: '600', fontSize: 13 },
});
