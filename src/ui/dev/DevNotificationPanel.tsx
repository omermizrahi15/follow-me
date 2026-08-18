import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  saveConfig,
  syncCandidatePhotos,
  scheduleTestNotification,
  recentCandidateUrls,
  candidateUrlsByAssetIds,
  saveTestApprovalBatch,
  SuggestionCache,
} from '../../composition/container';
import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import { assetIdsNeedingLookup, resolveChosenGalleryUrls } from '../../domain/services/notificationGallery';
import { showDevTools } from '../data/devTools';
import { radius, spacing } from '../theme/theme';

/**
 * The ⚡ test-notification buttons, and everything behind them.
 *
 * This module is deliberately the only thing in the app that knows how to fake
 * an approval push, and it is deliberately reachable through exactly one
 * import. `metro.config.js` swaps that import for `DevNotificationPanel.prod`
 * in a production bundle, which is what actually keeps this code — and the
 * sample gallery below — out of the shipped app.
 *
 * A runtime flag could not do that. Metro builds its dependency graph from
 * `require` calls long before a minifier sees `showDevTools && …`, so the old
 * boolean hid the buttons while shipping every line of this file, picsum URLs
 * included. The `showDevTools` check is still here as a second line of defence
 * for the dev-server and staging bundles that do include the module.
 */

// Fallback for the ⚡ buttons when the publisher has no synced or cached photos
// (fresh install, empty cloud, simulator): these public sample images + place
// let the test notification still exercise the full rich push — collapsed
// thumbnail, expandable gallery, and a location in the title.
const SAMPLE_GALLERY = [
  'https://picsum.photos/seed/followme1/800/800',
  'https://picsum.photos/seed/followme2/800/800',
  'https://picsum.photos/seed/followme3/800/800',
  'https://picsum.photos/seed/followme4/800/800',
  'https://picsum.photos/seed/followme5/800/800',
];
const SAMPLE_PLACE = 'Tel Aviv, Israel';

interface Props {
  publisherId: string;
  /**
   * The settings as they stand. The test push saves and then runs against this
   * exact config, so what it shows is what the real schedule would produce.
   */
  config: PublisherConfig;
}

/** Download what we can into the cache dir; failures are logged, never thrown. */
async function downloadAll(urls: string[], prefix: string, log: string[]): Promise<string[]> {
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const results = await Promise.allSettled(
    urls.map(async (url, i) => {
      try {
        const dl = await FileSystem.downloadAsync(url, `${dir}${prefix}-${i}.jpg`);
        return dl.status === 200 ? dl.uri : null;
      } catch (e) {
        log.push(`dl[${i}] error: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    }),
  );
  const uris: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value != null) uris.push(r.value);
    else if (r.status === 'rejected') log.push(`dl rejected: ${String(r.reason)}`);
  }
  return uris;
}

export function DevNotificationPanel({ publisherId, config }: Props): React.JSX.Element | null {
  const [scheduling, setScheduling] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);

  async function fireTestNotification(seconds: number): Promise<void> {
    setScheduling(true);
    const log: string[] = [];
    try {
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
        localUris.push(...(await downloadAll(resolved.urls, 'dev-notif', log)));
        log.push(`cache downloaded: ${localUris.length}`);
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
          const downloaded = await downloadAll(urls, 'cand-notif', log);
          localUris.push(...downloaded);
          log.push(`candidates downloaded: ${downloaded.length}`);
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
        localUris.push(...(await downloadAll(SAMPLE_GALLERY.slice(0, 3), 'sample-notif', log)));
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
      setScheduledAt(seconds >= 60 ? new Date(Date.now() + seconds * 1000) : null);
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
      setScheduling(false);
    }
  }

  if (!showDevTools) return null;

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.button, scheduling && styles.disabled]}
        onPress={() => void fireTestNotification(5)}
        activeOpacity={0.85}
        disabled={scheduling}
      >
        <Text style={styles.text}>{scheduling ? '…' : '⚡ Now'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, scheduling && styles.disabled]}
        onPress={() => void fireTestNotification(120)}
        activeOpacity={0.85}
        disabled={scheduling}
      >
        <Text style={styles.text}>
          {scheduling
            ? '…'
            : scheduledAt != null
            ? `⚡ At ${scheduledAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : '⚡ In 2 min'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs },
  button: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4a4a8a',
  },
  disabled: { opacity: 0.6 },
  text: { color: '#a0a0ff', fontWeight: '600', fontSize: 13 },
});
