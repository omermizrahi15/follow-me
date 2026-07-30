import { ShareMediaUseCase } from '../application/usecases/ShareMediaUseCase';
import { ListFeedUseCase } from '../application/usecases/ListFeedUseCase';
import { TrashPostingUseCase } from '../application/usecases/TrashPostingUseCase';
import { SubscribeUseCase } from '../application/usecases/SubscribeUseCase';
import { ListSubscribersUseCase } from '../application/usecases/ListSubscribersUseCase';
import { RemoveSubscriberUseCase } from '../application/usecases/RemoveSubscriberUseCase';
import { SaveConfigUseCase } from '../application/usecases/SaveConfigUseCase';
import { LoadConfigUseCase } from '../application/usecases/LoadConfigUseCase';
import { SuggestPhotosUseCase } from '../application/usecases/SuggestPhotosUseCase';
import { BackfillHistoryUseCase } from '../application/usecases/BackfillHistoryUseCase';
import { ScheduleReminderUseCase } from '../application/usecases/ScheduleReminderUseCase';
import { SyncCandidatePhotosUseCase } from '../application/usecases/SyncCandidatePhotosUseCase';
import { SaveProfileUseCase } from '../application/usecases/SaveProfileUseCase';
import { LoadProfileUseCase } from '../application/usecases/LoadProfileUseCase';
import { GeminiPhotoClassifier } from '../infrastructure/classifiers/GeminiPhotoClassifier';
import { ExpoMediaLibrary, expoResolvePayload, expoResolveLocalUri, expoResolveAssetLocation } from '../infrastructure/media/ExpoMediaLibrary';
import { ExpoNotificationScheduler } from '../infrastructure/notifiers/ExpoNotificationScheduler';
import { registerExpoPushToken } from '../infrastructure/notifiers/ExpoPushToken';
import type { Coordinate, ISentPhotoTracker } from '../domain/interfaces';
import { resolvePostingPlace } from '../application/services/resolvePostingPlace';
import { ConsoleConfirmationSender } from '../infrastructure/notifiers/ConsoleNotifier';
import { WhatsAppEdgeNotifier } from '../infrastructure/notifiers/WhatsAppEdgeNotifier';
import { RetryingNotifier } from '../infrastructure/notifiers/RetryingNotifier';
import { SupabaseNotificationDeliveryRepository } from '../infrastructure/repositories/SupabaseNotificationDeliveryRepository';
import { SupabaseAuthService } from '../infrastructure/auth/SupabaseAuthService';
import { SupabaseMediaRepository } from '../infrastructure/repositories/SupabaseMediaRepository';
import { SupabaseSubscriberRepository } from '../infrastructure/repositories/SupabaseSubscriberRepository';
import { SupabasePublisherConfigRepository } from '../infrastructure/repositories/SupabasePublisherConfigRepository';
import { SupabaseCandidatePhotoRepository } from '../infrastructure/repositories/SupabaseCandidatePhotoRepository';
import { SupabasePublisherProfileRepository } from '../infrastructure/repositories/SupabasePublisherProfileRepository';
import { SupabaseApprovalBatchRepository, type ApprovalBatch } from '../infrastructure/repositories/SupabaseApprovalBatchRepository';
import { CloudinaryStorageService } from '../infrastructure/storage/CloudinaryStorageService';
import { BigDataCloudGeocoder } from '../infrastructure/geocoding/BigDataCloudGeocoder';
import { MapTilerPlaceSearch } from '../infrastructure/geocoding/MapTilerPlaceSearch';
import { monitored, reportMessage } from '../infrastructure/monitoring/sentry';
import Constants from 'expo-constants';

/**
 * Asserts an EXPO_PUBLIC_* build-time variable is present. Callers MUST pass the
 * value via a static `process.env.EXPO_PUBLIC_X` reference (never a dynamic
 * `process.env[key]`): Expo only inlines static references into the production
 * bundle, so a dynamic lookup is `undefined` at runtime and blanks the app.
 */
function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const supabaseUrl = requireEnv(process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined, 'EXPO_PUBLIC_SUPABASE_URL');
const supabaseKey = requireEnv(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined, 'EXPO_PUBLIC_SUPABASE_ANON_KEY');

const mediaRepo = new SupabaseMediaRepository(supabaseUrl, supabaseKey);
const subscriberRepo = new SupabaseSubscriberRepository(supabaseUrl, supabaseKey);
const configRepo = new SupabasePublisherConfigRepository(supabaseUrl, supabaseKey);
const candidateRepo = new SupabaseCandidatePhotoRepository(supabaseUrl, supabaseKey);
const profileRepo = new SupabasePublisherProfileRepository(supabaseUrl, supabaseKey);
const approvalBatchRepo = new SupabaseApprovalBatchRepository(supabaseUrl, supabaseKey);
// Shared photo uploader (Cloudinary) — used for posts and profile avatars.
// The optional folder isolates staging uploads from production assets.
const storageService = new CloudinaryStorageService(
  requireEnv(process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME as string | undefined, 'EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME'),
  requireEnv(process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET as string | undefined, 'EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET'),
  process.env.EXPO_PUBLIC_CLOUDINARY_FOLDER as string | undefined,
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
const deliveryLog = new SupabaseNotificationDeliveryRepository(supabaseUrl, supabaseKey);
const notifier = new RetryingNotifier(
  new WhatsAppEdgeNotifier(`${supabaseUrl}/functions/v1/send-post`, supabaseKey),
  {
    onAttempt: (subscriber, media, attempt) =>
      deliveryLog.recordAttempt(media.map(m => m.id), subscriber.id, attempt),
  },
);
const confirmationSender = new ConsoleConfirmationSender();

const mediaLibrary = new ExpoMediaLibrary();
const photoClassifier = new GeminiPhotoClassifier(
  requireEnv(process.env.EXPO_PUBLIC_CLASSIFY_FN_URL as string | undefined, 'EXPO_PUBLIC_CLASSIFY_FN_URL'),
  supabaseKey,
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
const notificationScheduler = new ExpoNotificationScheduler();
// Already-sent = anything recorded in `media` for this publisher (id == asset id).
const sentPhotoTracker: ISentPhotoTracker = {
  sentCandidateIds: async publisherId =>
    new Set((await mediaRepo.findByOwner(publisherId)).map(m => m.id)),
};
// Names the posting's place ("Lisbon, Portugal") from the batch's EXIF GPS.
const geocoder = new BigDataCloudGeocoder();
// Place search for batches with no GPS. Shares the globe's MapTiler key: a
// handful of calls per post, against a quota the map tiles dominate. Unset key
// simply yields no suggestions (see MapTilerPlaceSearch).
export const placeSearch = new MapTilerPlaceSearch(
  (process.env.EXPO_PUBLIC_MAPTILER_KEY as string | undefined) ?? '',
);

/** Pre-resolves the posting's place so the review screen can show/edit it. */
export const resolvePlaceForCoordinates = (coordinates: Coordinate[]): Promise<string | null> =>
  resolvePostingPlace(geocoder, coordinates);

// Every use case is wrapped with `monitored`: an error escaping it reaches
// Sentry tagged `operation: <name>` (then rethrows — UI error handling is
// untouched). Tags make "which flow broke" filterable in Sentry (issue #10).
export const shareMedia = monitored('share_photo', new ShareMediaUseCase(mediaRepo, subscriberRepo, notifier, storageService, geocoder, deliveryLog));
export const listFeed = monitored('list_feed', new ListFeedUseCase(mediaRepo));
export const trashPosting = monitored('trash_posting', new TrashPostingUseCase(mediaRepo));
export const subscribe = monitored('subscribe', new SubscribeUseCase(subscriberRepo, confirmationSender));
export const listSubscribers = monitored('list_subscribers', new ListSubscribersUseCase(subscriberRepo));
export const removeSubscriber = monitored('remove_subscriber', new RemoveSubscriberUseCase(subscriberRepo));
export const authService = new SupabaseAuthService(supabaseUrl, supabaseKey);
export const saveConfig = monitored('save_config', new SaveConfigUseCase(configRepo));
export const loadConfig = monitored('load_config', new LoadConfigUseCase(configRepo));
const suggestPhotosUseCase = new SuggestPhotosUseCase(mediaLibrary, photoClassifier, sentPhotoTracker);
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
));
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
  photos: { id: string; url: string }[],
): Promise<string> => {
  const batchId = `dev-${publisherId}-${Date.now().toString(36)}`;
  await approvalBatchRepo.save(
    batchId,
    publisherId,
    photos.map(p => ({
      id: p.id,
      url: p.url,
      category: 'other' as const,
      caption: '',
      quality: 0,
      scene: '',
      createdAt: Date.now(),
    })),
  );
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
    const res = await fetch(`${supabaseUrl}/functions/v1/post-batch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey, 'Content-Type': 'application/json' },
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
export const deleteUploadedPhotos = monitored('delete_uploaded_photos', async (): Promise<{ deletedRows: number }> => {
  const token = (await authService.getSession())?.access_token;
  if (token == null) throw new Error('Not signed in');
  const res = await fetch(`${supabaseUrl}/functions/v1/delete-candidates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!res.ok) throw new Error(`Delete failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as { deletedRows: number };
});
