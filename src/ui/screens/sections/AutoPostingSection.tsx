import React, { useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  TouchableOpacity,
  Switch,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
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
  SuggestionCache,
  type CachedPhoto,
} from '../../../composition/container';
import { PublisherConfig, FREQUENCY_DAYS } from '../../../domain/entities/PublisherConfig';
import type { Frequency, PhotoCount } from '../../../domain/entities/PublisherConfig';
import { isWeekdayCadence } from '../../../domain/services/autoPostSchedule';
import { assetIdsNeedingLookup, resolveChosenGalleryUrls } from '../../../domain/services/notificationGallery';
import { enablePhotoSync, isPhotoSyncEnabled } from '../../data/photoSyncConsent';
import { useConnectionStatus } from '../../data/connectivity';
import { isUsable } from '../../../domain/services/connectivityCopy';
import { describeFailure } from '../../../domain/services/networkError';
import type { ConnectionStatus } from '../../../domain/entities/Connectivity';
import { runCandidateSyncQuietly } from '../../data/candidateSync';
import { PhotoSyncStatus } from './PhotoSyncStatus';
import { showDevTools } from '../../data/devTools';
import { SELECTABLE_CATEGORIES } from '../../../domain/entities/PhotoClassification';
import type { PhotoCategory } from '../../../domain/entities/PhotoClassification';
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

/**
 * Everything a save writes, flattened. Autosave compares this against the last
 * value the server acknowledged, so a re-render (or a section switch) can't
 * trigger a write that changes nothing.
 */
function snapshotOf(config: PublisherConfig): string {
  return JSON.stringify([
    config.frequency,
    config.photosPerPost,
    config.requireApproval,
    config.notifyDayOfWeek,
    config.notifyTime,
    config.enabledCategories,
    config.timezone,
    config.expoPushToken,
  ]);
}

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
  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [photoCount, setPhotoCount] = useState<PhotoCount>(10);
  const [askBeforePost, setAskBeforePost] = useState(true);
  const [notifyDayOfWeek, setNotifyDayOfWeek] = useState(0);
  const [notifyTime, setNotifyTime] = useState('18:00');
  const [orderedCats, setOrderedCats] = useState<OrderedCategory[]>(() =>
    SELECTABLE_CATEGORIES.map(cat => ({ cat, enabled: true })),
  );
  const [pushToken, setPushToken] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  // The failure itself, so the status line can say whether it was the
  // connection or the server. `null` while the failure is simply "offline",
  // which the app knows without having tried (issue #145).
  const [saveError, setSaveError] = useState<unknown>(null);
  const connection = useConnectionStatus();
  const [previewing, setPreviewing] = useState(false);
  const [testScheduling, setTestScheduling] = useState(false);
  const [testScheduledAt, setTestScheduledAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  useEffect(() => {
    void (async (): Promise<void> => {
      const config = await loadConfig.execute(publisherId);
      setFrequency(config.frequency);
      setPhotoCount(config.photosPerPost);
      setAskBeforePost(config.requireApproval);
      setNotifyDayOfWeek(config.notifyDayOfWeek);
      setNotifyTime(config.notifyTime);
      setOrderedCats(buildOrderedList(config.enabledCategories));
      setPushToken(config.expoPushToken);
      savedSnapshotRef.current = snapshotOf(config);
      syncedLookbackRef.current = config.lookbackDays;
      setIsLoading(false);
    })();
  }, [publisherId]);

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

  /**
   * Write the settings as they stand. Every control calls this through the
   * debounce below — there is no Save button, so this is the only writer.
   */
  async function persistConfig(): Promise<void> {
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
    const config = buildCurrentConfig(token);
    const snapshot = snapshotOf(config);
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
      await saveConfig.execute(config);
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
      if (config.lookbackDays !== syncedLookbackRef.current) {
        syncedLookbackRef.current = config.lookbackDays;
        if (await isPhotoSyncEnabled()) {
          void runCandidateSyncQuietly(
            publisherId,
            'settings_sync_candidates',
            config.lookbackDays,
          );
        }
      }
      if (config.expoPushToken !== '') {
        // Server owns the reminder — cancel the local one to avoid double-notifying.
        await scheduleReminder.cancel().catch(() => undefined);
      } else {
        // No push token (permissions denied / simulator) — local reminder fallback.
        await scheduleReminder.execute(config).catch(() => undefined);
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
  }

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
    if (isLoading) return;
    const snapshot = snapshotOf(buildCurrentConfig(pushToken));
    if (snapshot === savedSnapshotRef.current) return;
    pendingRef.current = true;
    const timer = setTimeout(() => void persistRef.current(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [
    isLoading,
    frequency,
    photoCount,
    askBeforePost,
    notifyDayOfWeek,
    notifyTime,
    orderedCats,
    pushToken,
  ]);

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
      let postablePhotos: CachedPhoto[] = [];
      let postablePool: CachedPhoto[] = [];
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
        // Carry each photo's real grade across, replacing only the uri with the
        // cloud copy the server can read. Passing bare {id, url} pairs meant the
        // saved batch had to invent category/quality/caption/scene, and what it
        // invented — `other`, quality 0 — is exactly what a failed
        // classification looks like, so the test push exercised the broken
        // shape rather than the real one.
        const gradeById = new Map(cached.batch.map(p => [p.id, p]));
        postablePhotos = resolved.photos.flatMap(p => {
          const grade = gradeById.get(p.id);
          return grade == null ? [] : [{ ...grade, url: p.url }];
        });
        postablePool = cached.pool;
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
          batchId = await saveTestApprovalBatch(publisherId, postablePhotos, postablePool);
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
    })();
  }

  /** Retry after a failed sync. Same call as every other trigger — nothing special. */
  function handleRetrySync(): void {
    void (async (): Promise<void> => {
      await runCandidateSyncQuietly(publisherId, 'settings_retry_sync');
    })();
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


      {showDevTools && (
        <View style={styles.devRow}>
          <TouchableOpacity
            style={[styles.devButton, styles.devButtonFull, testScheduling && styles.buttonDisabled]}
            onPress={handleTestNow}
            activeOpacity={0.85}
            disabled={testScheduling}
          >
            <Text style={styles.devText}>{testScheduling ? '…' : '⚡ Now'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.devButton, styles.devButtonFull, testScheduling && styles.buttonDisabled]}
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
  devText: { color: '#a0a0ff', fontWeight: '600', fontSize: 13 },
});
