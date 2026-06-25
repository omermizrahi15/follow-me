import { ShareMediaUseCase } from '../application/usecases/ShareMediaUseCase';
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
import type { ISentPhotoTracker } from '../domain/interfaces';
import { ConsoleNotifier, ConsoleConfirmationSender } from '../infrastructure/notifiers/ConsoleNotifier';
import { SupabaseAuthService } from '../infrastructure/auth/SupabaseAuthService';
import { SupabaseMediaRepository } from '../infrastructure/repositories/SupabaseMediaRepository';
import { SupabaseSubscriberRepository } from '../infrastructure/repositories/SupabaseSubscriberRepository';
import { SupabasePublisherConfigRepository } from '../infrastructure/repositories/SupabasePublisherConfigRepository';
import { SupabaseCandidatePhotoRepository } from '../infrastructure/repositories/SupabaseCandidatePhotoRepository';
import { SupabasePublisherProfileRepository } from '../infrastructure/repositories/SupabasePublisherProfileRepository';
import { CloudinaryStorageService } from '../infrastructure/storage/CloudinaryStorageService';
import Constants from 'expo-constants';

function requireEnv(key: string): string {
  const value = process.env[key] as string | undefined;
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

const supabaseUrl = requireEnv('EXPO_PUBLIC_SUPABASE_URL');
const supabaseKey = requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');

const mediaRepo = new SupabaseMediaRepository(supabaseUrl, supabaseKey);
const subscriberRepo = new SupabaseSubscriberRepository(supabaseUrl, supabaseKey);
const configRepo = new SupabasePublisherConfigRepository(supabaseUrl, supabaseKey);
const candidateRepo = new SupabaseCandidatePhotoRepository(supabaseUrl, supabaseKey);
const profileRepo = new SupabasePublisherProfileRepository(supabaseUrl, supabaseKey);
// Shared image/video uploader (Cloudinary) — used for posts and profile avatars.
export const storage = new CloudinaryStorageService(
  requireEnv('EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME'),
  requireEnv('EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET'),
);
// TODO(#24): replace with WhatsApp implementations once notifications move server-side
const notifier = new ConsoleNotifier('Omer');
const confirmationSender = new ConsoleConfirmationSender();

const mediaLibrary = new ExpoMediaLibrary();
const photoClassifier = new GeminiPhotoClassifier(
  requireEnv('EXPO_PUBLIC_CLASSIFY_FN_URL'),
  supabaseKey,
  expoResolvePayload,
);
const notificationScheduler = new ExpoNotificationScheduler();
// Already-sent = anything recorded in `media` for this publisher (id == asset id).
const sentPhotoTracker: ISentPhotoTracker = {
  sentCandidateIds: async publisherId =>
    new Set((await mediaRepo.findByOwner(publisherId)).map(m => m.id)),
};

export const shareMedia = new ShareMediaUseCase(mediaRepo, subscriberRepo, notifier, storage);
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
