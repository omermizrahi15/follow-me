import { ShareMediaUseCase } from '../application/usecases/ShareMediaUseCase';
import { ListFeedUseCase } from '../application/usecases/ListFeedUseCase';
import { SubscribeUseCase } from '../application/usecases/SubscribeUseCase';
import { ListSubscribersUseCase } from '../application/usecases/ListSubscribersUseCase';
import { RemoveSubscriberUseCase } from '../application/usecases/RemoveSubscriberUseCase';
import { SaveConfigUseCase } from '../application/usecases/SaveConfigUseCase';
import { LoadConfigUseCase } from '../application/usecases/LoadConfigUseCase';
import { SuggestPhotosUseCase } from '../application/usecases/SuggestPhotosUseCase';
import { ScheduleReminderUseCase } from '../application/usecases/ScheduleReminderUseCase';
import { SyncCandidatePhotosUseCase } from '../application/usecases/SyncCandidatePhotosUseCase';
import { SaveProfileUseCase } from '../application/usecases/SaveProfileUseCase';
import { LoadProfileUseCase } from '../application/usecases/LoadProfileUseCase';
import { GeminiPhotoClassifier } from '../infrastructure/classifiers/GeminiPhotoClassifier';
import { ExpoMediaLibrary, expoResolvePayload, expoResolveLocalUri } from '../infrastructure/media/ExpoMediaLibrary';
import { ExpoNotificationScheduler } from '../infrastructure/notifiers/ExpoNotificationScheduler';
import { registerExpoPushToken } from '../infrastructure/notifiers/ExpoPushToken';
import type { Coordinate, ISentPhotoTracker, SongSuggestionContext } from '../domain/interfaces';
import type { Song } from '../domain/entities/Song';
import { ITunesMusicCatalog } from '../infrastructure/music/ITunesMusicCatalog';
import { EdgeFunctionSongSuggester } from '../infrastructure/music/EdgeFunctionSongSuggester';
import { expoReadSuggestionPhoto } from '../infrastructure/media/suggestionPhoto';
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
import { CloudinaryStorageService } from '../infrastructure/storage/CloudinaryStorageService';
import { BigDataCloudGeocoder } from '../infrastructure/geocoding/BigDataCloudGeocoder';
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
// Shared photo uploader (Cloudinary) — used for posts and profile avatars.
export const storage = new CloudinaryStorageService(
  requireEnv(process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME as string | undefined, 'EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME'),
  requireEnv(process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET as string | undefined, 'EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET'),
);
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
);
const notificationScheduler = new ExpoNotificationScheduler();
// Already-sent = anything recorded in `media` for this publisher (id == asset id).
const sentPhotoTracker: ISentPhotoTracker = {
  sentCandidateIds: async publisherId =>
    new Set((await mediaRepo.findByOwner(publisherId)).map(m => m.id)),
};
// Names the posting's place ("Lisbon, Portugal") from the batch's EXIF GPS.
const geocoder = new BigDataCloudGeocoder();

// Posting soundtrack (issue #54): keyless iTunes Search supplies previews and
// artwork; the suggest-song Edge Function (Gemini) proposes candidates that
// are resolved against that catalog.
const musicCatalog = new ITunesMusicCatalog();
const songSuggester = new EdgeFunctionSongSuggester(
  `${supabaseUrl}/functions/v1/suggest-song`,
  supabaseKey,
  musicCatalog,
  // Requires a signed-in user's JWT (anon key rejected) — same posture as
  // classify-photos. authService is declared below; the closure runs later.
  async () => (await authService.getSession())?.access_token ?? null,
  // Downsized post photos ride along so the AI matches the song to them.
  expoReadSuggestionPhoto,
);

/** Free-text song search for the picker's manual mode. */
export const searchSongs = (term: string): Promise<Song[]> => musicCatalog.searchSongs(term);

/** AI song suggestions for a posting; null when unavailable (picker falls back to search). */
export const suggestSong = (context: SongSuggestionContext): Promise<Song[] | null> =>
  songSuggester.suggest(context);

/** Pre-resolves the posting's place so the review screen can show/edit it. */
export const resolvePlaceForCoordinates = (coordinates: Coordinate[]): Promise<string | null> =>
  resolvePostingPlace(geocoder, coordinates);

export const shareMedia = new ShareMediaUseCase(mediaRepo, subscriberRepo, notifier, storage, geocoder, deliveryLog);
export const listFeed = new ListFeedUseCase(mediaRepo);
export const subscribe = new SubscribeUseCase(subscriberRepo, confirmationSender);
export const listSubscribers = new ListSubscribersUseCase(subscriberRepo);
export const removeSubscriber = new RemoveSubscriberUseCase(subscriberRepo);
export const authService = new SupabaseAuthService(supabaseUrl, supabaseKey);
export const saveConfig = new SaveConfigUseCase(configRepo);
export const loadConfig = new LoadConfigUseCase(configRepo);
export const suggestPhotos = new SuggestPhotosUseCase(mediaLibrary, photoClassifier, sentPhotoTracker);
export const scheduleReminder = new ScheduleReminderUseCase(notificationScheduler);
export const syncCandidatePhotos = new SyncCandidatePhotosUseCase(
  mediaLibrary,
  storage,
  candidateRepo,
  expoResolveLocalUri,
);
export const saveProfile = new SaveProfileUseCase(profileRepo);
export const loadProfile = new LoadProfileUseCase(profileRepo);

const easProjectId =
  (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ?? '';

/** Register the device's Expo push token (for autonomous-mode reminders). */
export const registerPushToken = (): Promise<string | null> => registerExpoPushToken(easProjectId);

/** The device's current IANA timezone, stored so the server fires at local time. */
export const deviceTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** DEV ONLY — schedule the approval-flow reminder to fire in `seconds` seconds. */
export const scheduleTestNotification = (seconds: number, localAttachmentUris: string[] = []): Promise<void> =>
  notificationScheduler.scheduleTestIn(seconds, localAttachmentUris);

/** DEV ONLY — recent cloud-synced photo URLs (Cloudinary) for notification tests. */
export const recentCandidateUrls = (publisherId: string, limit: number): Promise<string[]> =>
  candidateRepo.recentUrls(publisherId, limit);

/**
 * "Delete my uploaded photos" — server-side wipe of the signed-in user's
 * candidate_photos rows (+ best-effort Cloudinary asset cleanup). Requires an
 * authenticated session; the server only deletes the caller's own photos.
 */
export const deleteUploadedPhotos = async (): Promise<{ deletedRows: number }> => {
  const token = (await authService.getSession())?.access_token;
  if (token == null) throw new Error('Not signed in');
  const res = await fetch(`${supabaseUrl}/functions/v1/delete-candidates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!res.ok) throw new Error(`Delete failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as { deletedRows: number };
};
