import { ShareMediaUseCase } from '../application/usecases/ShareMediaUseCase';
import { ListFeedUseCase } from '../application/usecases/ListFeedUseCase';
import { TrashPostingUseCase } from '../application/usecases/TrashPostingUseCase';
import { SubscribeUseCase } from '../application/usecases/SubscribeUseCase';
import { ListSubscribersUseCase } from '../application/usecases/ListSubscribersUseCase';
import { RemoveSubscriberUseCase } from '../application/usecases/RemoveSubscriberUseCase';
import { ResolveContactNamesUseCase } from '../application/usecases/ResolveContactNamesUseCase';
import { SaveConfigUseCase } from '../application/usecases/SaveConfigUseCase';
import { LoadConfigUseCase } from '../application/usecases/LoadConfigUseCase';
import { SuggestPhotosUseCase } from '../application/usecases/SuggestPhotosUseCase';
import { GetAiUsageUseCase } from '../application/usecases/GetAiUsageUseCase';
import { PhotoSelectionService } from '../domain/services/PhotoSelectionService';
import { ClassificationCache } from '../infrastructure/cache/ClassificationCache';
import { BackfillHistoryUseCase } from '../application/usecases/BackfillHistoryUseCase';
import { ScheduleReminderUseCase } from '../application/usecases/ScheduleReminderUseCase';
import { SyncCandidatePhotosUseCase } from '../application/usecases/SyncCandidatePhotosUseCase';
import { SaveProfileUseCase } from '../application/usecases/SaveProfileUseCase';
import { LoadProfileUseCase } from '../application/usecases/LoadProfileUseCase';
import { GeminiPhotoClassifier } from '../infrastructure/classifiers/GeminiPhotoClassifier';
import { ClassifyQuotaReader } from '../infrastructure/classifiers/ClassifyQuotaReader';
import { ExpoMediaLibrary, expoResolvePayload, expoResolveLocalUri, expoResolveAssetLocation } from '../infrastructure/media/ExpoMediaLibrary';
import { ExpoNotificationScheduler } from '../infrastructure/notifiers/ExpoNotificationScheduler';
import { ExpoContactsDirectory } from '../infrastructure/contacts/ExpoContactsDirectory';
import { registerExpoPushToken } from '../infrastructure/notifiers/ExpoPushToken';
import type { Coordinate, ISentPhotoTracker, PhotoSyncState } from '../domain/interfaces';
import { resolvePostingPlace } from '../application/services/resolvePostingPlace';
import { createQueryCache } from '../application/services/queryCache';
import { ConsoleConfirmationSender } from '../infrastructure/notifiers/ConsoleNotifier';
import { WhatsAppEdgeNotifier } from '../infrastructure/notifiers/WhatsAppEdgeNotifier';
import { RetryingNotifier } from '../infrastructure/notifiers/RetryingNotifier';
import { SupabaseNotificationDeliveryRepository } from '../infrastructure/repositories/SupabaseNotificationDeliveryRepository';
import { SupabaseAuthService } from '../infrastructure/auth/SupabaseAuthService';
import { SupabaseMediaRepository } from '../infrastructure/repositories/SupabaseMediaRepository';
import { SupabasePostGalleryRepository } from '../infrastructure/repositories/SupabasePostGalleryRepository';
import { SupabaseSubscriberRepository } from '../infrastructure/repositories/SupabaseSubscriberRepository';
import { SupabasePublisherConfigRepository } from '../infrastructure/repositories/SupabasePublisherConfigRepository';
import { SupabaseCandidatePhotoRepository } from '../infrastructure/repositories/SupabaseCandidatePhotoRepository';
import { SupabasePublisherProfileRepository } from '../infrastructure/repositories/SupabasePublisherProfileRepository';
import { SupabaseApprovalBatchRepository, type ApprovalBatch } from '../infrastructure/repositories/SupabaseApprovalBatchRepository';
import { CloudinaryStorageService } from '../infrastructure/storage/CloudinaryStorageService';
import { BigDataCloudGeocoder } from '../infrastructure/geocoding/BigDataCloudGeocoder';
import { MapTilerPlaceSearch } from '../infrastructure/geocoding/MapTilerPlaceSearch';
import { monitored, reportError, reportMessage } from '../infrastructure/monitoring/sentry';
import { ConnectivityMonitor } from '../infrastructure/connectivity/ConnectivityMonitor';
import { netInfoSource } from '../infrastructure/connectivity/netInfoSource';
import { mediaLibraryAssetLocation } from '../infrastructure/media/assetLocation';
import {
  SuggestionCache,
  cachedPhotoToClassification,
  classificationToCachedPhoto,
  type CachedPhoto,
  type CachedSuggestion,
} from '../infrastructure/cache/SuggestionCache';
import { supabase, supabaseUrl, supabaseAnonKey } from '../infrastructure/supabase/client';
import { slowFetch } from '../infrastructure/http/appFetch';
import { env } from '../infrastructure/env';
import Constants from 'expo-constants';

// One client for the whole app (issue #115). Every repository below shares it,
// so a signed-in user's JWT rides along on every query and the `auth.uid()` RLS
// policies (migration 20240031) resolve to that user.
//
// Its url/key come from ../infrastructure/env, which checks every required
// variable as a set and never throws (issue #110): while anything is missing
// they are inert placeholders and the UI renders the setup message rather than
// the navigator, so none of the wiring below is ever reached.
const mediaRepo = new SupabaseMediaRepository(supabase);
// The followers' copy of a posting — what the gallery link opens. Deleting a
// post has to hide this too, not just the publisher's own feed.
const postGalleryRepo = new SupabasePostGalleryRepository(supabase);
const subscriberRepo = new SupabaseSubscriberRepository(supabase);
const configRepo = new SupabasePublisherConfigRepository(supabase);
const candidateRepo = new SupabaseCandidatePhotoRepository(supabase);
const profileRepo = new SupabasePublisherProfileRepository(supabase);
const approvalBatchRepo = new SupabaseApprovalBatchRepository(supabase);
// Shared photo uploader (Cloudinary) — used for posts and profile avatars.
// The optional folder isolates staging uploads from production assets.
const storageService = new CloudinaryStorageService(
  env.cloudinaryCloudName,
  env.cloudinaryUploadPreset,
  env.cloudinaryFolder,
);
// Direct UI uploads (avatars) get their own Sentry tag; use cases below hold
// the raw service so their failures are tagged with the use case's operation
// instead of double-reporting through both wrappers.
export const storage = monitored('photo_upload', storageService);
// Manual posts send WhatsApp via the send-post Edge Function (Twilio creds stay
// server-side, issue #24). Subscribe confirmations are server-side too (the
// subscribe / join-webhook functions); the in-app sender below is dev-only.
// Delivery tracking (issue #11): every send is logged per (photo, subscriber)
// in notification_deliveries, and failures retry with 1s/4s/16s backoff.
const deliveryLog = new SupabaseNotificationDeliveryRepository(supabase);
const notifier = new RetryingNotifier(
  new WhatsAppEdgeNotifier(`${supabaseUrl}/functions/v1/send-post`, supabaseAnonKey),
  {
    onAttempt: (subscriber, media, attempt) =>
      deliveryLog.recordAttempt(media.map(m => m.id), subscriber.id, attempt),
  },
);
const confirmationSender = new ConsoleConfirmationSender();

const mediaLibrary = new ExpoMediaLibrary();
const photoClassifier = new GeminiPhotoClassifier(
  env.classifyFnUrl,
  supabaseAnonKey,
  expoResolvePayload,
  // The classify function requires a signed-in user's JWT (anon key rejected).
  // authService is declared below — the closure runs long after module init.
  async () => (await authService.getSession())?.access_token ?? null,
  // The daily AI budget running out is expected and handled, so nothing ever
  // throws — without an explicit event we'd have no idea how often real
  // publishers hit it mid-backfill (issue #81).
  photosInRun =>
    reportMessage('classify-photos daily quota exhausted', 'classify_photos', { photosInRun }),
);
/**
 * The same daily budget the classifier spends, read rather than spent (the
 * classify function answers GET with the caller's count and its own ceiling).
 * Surfaced only by the staging usage bar — see src/ui/dev/AiUsageBar.tsx.
 */
const aiUsageReader = new ClassifyQuotaReader(
  env.classifyFnUrl,
  supabaseAnonKey,
  async () => (await authService.getSession())?.access_token ?? null,
);
export const getAiUsage = monitored('get_ai_usage', new GetAiUsageUseCase(aiUsageReader));

const notificationScheduler = new ExpoNotificationScheduler();
// Already-sent = anything recorded in `media` for this publisher (id == asset id).
// Ids only: this runs on every suggestion scan and every "+" top-up, and used
// to read every column of every photo the publisher had ever posted (#116).
const sentPhotoTracker: ISentPhotoTracker = {
  sentCandidateIds: publisherId => mediaRepo.postedAssetIds(publisherId),
  // The newest photo they have already posted. Deleted postings still count:
  // the publisher saw those photos and chose them once, so re-offering them as
  // "new since your last post" would be a worse surprise than missing them.
  //
  // One row answers it: the store returns an owner's media newest first.
  newestPostedPhotoAt: async publisherId =>
    (await mediaRepo.findByOwner(publisherId, { limit: 1 }))[0]?.createdAt ?? null,
};
// Names the posting's place ("Lisbon, Portugal") from the batch's EXIF GPS.
const geocoder = new BigDataCloudGeocoder();
// Place search for batches with no GPS. Shares the globe's MapTiler key: a
// handful of calls per post, against a quota the map tiles dominate. Unset key
// simply yields no suggestions (see MapTilerPlaceSearch).
export const placeSearch = new MapTilerPlaceSearch(env.maptilerKey);

/** Pre-resolves the posting's place so the review screen can show/edit it. */
export const resolvePlaceForCoordinates = (coordinates: Coordinate[]): Promise<string | null> =>
  resolvePostingPlace(geocoder, coordinates);

// Every use case is wrapped with `monitored`: an error escaping it reaches
// Sentry tagged `operation: <name>` (then rethrows — UI error handling is
// untouched). Tags make "which flow broke" filterable in Sentry (issue #10).
export const shareMedia = monitored('share_photo', new ShareMediaUseCase(mediaRepo, subscriberRepo, notifier, storageService, geocoder, deliveryLog));
export const listFeed = monitored('list_feed', new ListFeedUseCase(mediaRepo));
export const trashPosting = monitored('trash_posting', new TrashPostingUseCase(mediaRepo, postGalleryRepo));
export const subscribe = monitored('subscribe', new SubscribeUseCase(subscriberRepo, confirmationSender));
export const listSubscribers = monitored('list_subscribers', new ListSubscribersUseCase(subscriberRepo));
export const removeSubscriber = monitored('remove_subscriber', new RemoveSubscriberUseCase(subscriberRepo));
// Follower names come from the device address book and stay there (issue #144):
// this use case reads contacts locally, matches them against numbers the app
// already holds, and returns nothing but names for those numbers.
export const resolveContactNames = monitored(
  'resolve_contact_names',
  new ResolveContactNamesUseCase(new ExpoContactsDirectory()),
);
export const authService = new SupabaseAuthService(supabase);
export const saveConfig = monitored('save_config', new SaveConfigUseCase(configRepo));
export const loadConfig = monitored('load_config', new LoadConfigUseCase(configRepo));
// The grade store is what makes grading the whole window affordable: a photo is
// classified once ever, so rescans, reopens and swaps cost nothing.
const suggestPhotosUseCase = new SuggestPhotosUseCase(
  mediaLibrary,
  photoClassifier,
  sentPhotoTracker,
  new PhotoSelectionService(),
  ClassificationCache,
  undefined,
  // The face "photos of me" matches against (issue #137). It is the profile
  // photo and nothing else — no enrolment, no second signature to keep, and
  // nothing to wipe beyond the avatar the publisher can already remove. The
  // use case decides whether to ask for it at all; this only knows where it
  // lives.
  async publisherId => (await profileRepo.findByPublisher(publisherId))?.avatarUrl ?? null,
);
export const suggestPhotos = monitored('suggest_photos', suggestPhotosUseCase);
// Reconstructs pre-app travel history one cadence-window at a time (issue #81).
// Takes the unwrapped suggest use case so a window's failure is tagged
// `backfill_history` rather than double-reported as a live suggestion.
export const backfillHistory = monitored(
  'backfill_history',
  new BackfillHistoryUseCase(suggestPhotosUseCase, photoClassifier),
);
export const scheduleReminder = monitored('schedule_reminder', new ScheduleReminderUseCase(notificationScheduler));
export const syncCandidatePhotos = monitored('sync_candidate_photos', new SyncCandidatePhotosUseCase(
  mediaLibrary,
  storageService,
  candidateRepo,
  expoResolveLocalUri,
  expoResolveAssetLocation,
  sentPhotoTracker,
));
/**
 * Tells the server's posting job what this device's photo sync is doing
 * (issue #97): `active` is the heartbeat, written after every successful sync
 * including one that uploaded nothing; `paused`/`no-consent` say upload is
 * switched off, so the job stops waiting for photos that will never arrive.
 */
export const recordSyncState = monitored(
  'record_sync_state',
  (publisherId: string, state: PhotoSyncState): Promise<void> =>
    configRepo.recordSyncState(publisherId, state, new Date()),
);
export const saveProfile = monitored('save_profile', new SaveProfileUseCase(profileRepo));
export const loadProfile = monitored('load_profile', new LoadProfileUseCase(profileRepo));

const easProjectId =
  (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ?? '';

/** Register the device's Expo push token (for autonomous-mode reminders). */
export const registerPushToken = monitored('register_push_token', (): Promise<string | null> =>
  registerExpoPushToken(easProjectId));

/** The device's current IANA timezone, stored so the server fires at local time. */
export const deviceTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** DEV ONLY — schedule the approval-flow reminder to fire in `seconds` seconds. */
export const scheduleTestNotification = (
  seconds: number,
  localAttachmentUris: string[] = [],
  galleryUrls: string[] = [],
  place?: string | null,
  batchId?: string,
): Promise<void> =>
  notificationScheduler.scheduleTestIn(seconds, localAttachmentUris, galleryUrls, place, batchId);

/**
 * DEV ONLY — persist a batch the app already chose so the test notification's
 * "Post now" hits the same server path the real approval push does. Returns the
 * batch id to put in the notification payload.
 */
export const saveTestApprovalBatch = async (
  publisherId: string,
  batch: CachedPhoto[],
  pool: CachedPhoto[] = [],
): Promise<string> => {
  const batchId = `dev-${publisherId}-${Date.now().toString(36)}`;
  // The real grades, not stand-ins. This used to stamp every photo
  // `category: 'other', quality: 0, caption: '', scene: ''` — the exact shape a
  // failed classification used to produce — so a batch opened from a test push
  // was indistinguishable from a broken one, and ranked bottom-first.
  await approvalBatchRepo.save(batchId, publisherId, batch, pool);
  return batchId;
};

/** DEV ONLY — recent cloud-synced photo URLs (Cloudinary) for notification tests. */
export const recentCandidateUrls = (publisherId: string, limit: number): Promise<string[]> =>
  candidateRepo.recentUrls(publisherId, limit);

/**
 * Cloud copies of specific chosen photos, keyed by asset id (issue #85). Lets the
 * test notification show the batch the review screen picked even when that batch
 * came from a device scan and holds unusable `ph://` uris.
 */
export const candidateUrlsByAssetIds = (
  publisherId: string,
  assetIds: string[],
): Promise<Map<string, string>> => candidateRepo.urlsByAssetIds(publisherId, assetIds);

/**
 * Fetch a server-persisted approval batch by id (issue #71). The rich approval
 * push carries only a `batchId`; the app resolves the full batch/pool here to
 * populate the review screen without a device rescan.
 */
export const fetchApprovalBatch = monitored(
  'fetch_approval_batch',
  (batchId: string): Promise<ApprovalBatch | null> => approvalBatchRepo.fetch(batchId),
);

/**
 * Publish an approval batch server-side — the "Post now" notification action.
 *
 * The batch's photos already live in the cloud, so nothing has to be read from
 * the device: one authenticated call and the server sends to the followers and
 * pushes back a "Posted ✅" confirmation. That is what lets the action run from
 * a background launch without the app ever coming to the foreground.
 *
 * Idempotent server-side (the batch row is claimed before sending), so a
 * redelivered notification response returns the original posting id.
 */
export const publishApprovalBatch = monitored(
  'publish_approval_batch',
  async (batchId: string): Promise<{ postingId: string | null }> => {
    const token = (await authService.getSession())?.access_token;
    if (token == null) throw new Error('Not signed in');
    const res = await slowFetch(`${supabaseUrl}/functions/v1/post-batch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId }),
    });
    if (!res.ok) throw new Error(`Post failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as { postingId: string | null };
  },
);

/**
 * "Delete my uploaded photos" — server-side wipe of the signed-in user's
 * candidate_photos rows (+ best-effort Cloudinary asset cleanup). Requires an
 * authenticated session; the server only deletes the caller's own photos.
 */
export const deleteUploadedPhotos = monitored('delete_uploaded_photos', async (): Promise<{ deletedRows: number }> =>
  deleteCandidates({}),
);

/**
 * Routine retention: drop cloud copies older than `olderThanDays`.
 *
 * Same endpoint as the wipe, scoped by age. Nothing outside the lookback window
 * can be chosen for a post, so keeping those copies served no one — and until
 * this existed the set only ever grew, which is why the app had to ask the
 * publisher to clean up after it.
 */
export const pruneUploadedPhotos = monitored(
  'prune_uploaded_photos',
  async (olderThanDays: number): Promise<{ deletedRows: number }> => deleteCandidates({ olderThanDays }),
);

async function deleteCandidates(body: { olderThanDays?: number }): Promise<{ deletedRows: number }> {
  const token = (await authService.getSession())?.access_token;
  if (token == null) throw new Error('Not signed in');
  const res = await slowFetch(`${supabaseUrl}/functions/v1/delete-candidates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Delete failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as { deletedRows: number };
}

// ── Infrastructure the UI binds to here, not by reaching across the boundary ──
//
// These are not use cases, so there is nothing to wrap: they are device and
// platform capabilities the UI genuinely needs (an on-device cache, the photo
// library, the crash reporter). Naming them here keeps the composition root the
// single place that knows which implementation is in play — swapping Sentry for
// another reporter, or the cache for a different store, stays a one-line change
// and no screen has to be touched. Screens importing them from
// `infrastructure/` directly is the boundary breach that #107 uncovered.

/** Crash and event reporting. Callers pass the operation name that failed. */
export { reportError, reportMessage };

/**
 * The app's one read cache (issue #114). Every screen that wants the feed, the
 * profile or the followers goes through it, so the same row is fetched once and
 * shared rather than once per hook instance. Bound here because "which cache"
 * is a composition decision; the hooks only know the interface.
 */
export const queryCache = createQueryCache();

/**
 * The app's single answer to "are we online?" (issue #145) — started by the
 * root, read through `ui/data/connectivity`.
 *
 * One instance for the process, so every consumer sees the same settled status
 * and the platform is subscribed to once. The NetInfo binding is named here for
 * the usual reason: swapping it (or handing a fake to a screen under test)
 * stays a one-line change in the composition root.
 */
export const connectivity = new ConnectivityMonitor(netInfoSource);

/** Local URI for a media-library asset, and that asset's recorded GPS fix. */
export { expoResolveLocalUri, mediaLibraryAssetLocation };

/**
 * On-device cache of the last photo suggestion, so a reminder tapped hours
 * later shows the same batch the server picked.
 */
export {
  SuggestionCache,
  cachedPhotoToClassification,
  classificationToCachedPhoto,
  type CachedPhoto,
  type CachedSuggestion,
};
