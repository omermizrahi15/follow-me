import { ShareMediaUseCase } from '../application/usecases/ShareMediaUseCase';
import { ListFeedUseCase } from '../application/usecases/ListFeedUseCase';
import { SubscribeUseCase } from '../application/usecases/SubscribeUseCase';
import { ListSubscribersUseCase } from '../application/usecases/ListSubscribersUseCase';
import { RemoveSubscriberUseCase } from '../application/usecases/RemoveSubscriberUseCase';
import { SaveConfigUseCase } from '../application/usecases/SaveConfigUseCase';
import { LoadConfigUseCase } from '../application/usecases/LoadConfigUseCase';
import { SaveProfileUseCase } from '../application/usecases/SaveProfileUseCase';
import { LoadProfileUseCase } from '../application/usecases/LoadProfileUseCase';
import { ConsoleNotifier, ConsoleConfirmationSender } from '../infrastructure/notifiers/ConsoleNotifier';
import { SupabaseAuthService } from '../infrastructure/auth/SupabaseAuthService';
import { SupabaseMediaRepository } from '../infrastructure/repositories/SupabaseMediaRepository';
import { SupabaseSubscriberRepository } from '../infrastructure/repositories/SupabaseSubscriberRepository';
import { SupabasePublisherConfigRepository } from '../infrastructure/repositories/SupabasePublisherConfigRepository';
import { SupabasePublisherProfileRepository } from '../infrastructure/repositories/SupabasePublisherProfileRepository';
import { CloudinaryStorageService } from '../infrastructure/storage/CloudinaryStorageService';
import { BigDataCloudGeocoder } from '../infrastructure/geocoding/BigDataCloudGeocoder';

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
const profileRepo = new SupabasePublisherProfileRepository(supabaseUrl, supabaseKey);
// Shared image/video uploader (Cloudinary) — used for posts and profile avatars.
export const storage = new CloudinaryStorageService(
  requireEnv('EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME'),
  requireEnv('EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET'),
);
// TODO(#24): replace with WhatsApp implementations once notifications move server-side
const notifier = new ConsoleNotifier('Omer');
const confirmationSender = new ConsoleConfirmationSender();

// Names the posting's place ("Lisbon, Portugal") from the batch's EXIF GPS.
const geocoder = new BigDataCloudGeocoder();

export const shareMedia = new ShareMediaUseCase(mediaRepo, subscriberRepo, notifier, storage, geocoder);
export const listFeed = new ListFeedUseCase(mediaRepo);
export const subscribe = new SubscribeUseCase(subscriberRepo, confirmationSender);
export const listSubscribers = new ListSubscribersUseCase(subscriberRepo);
export const removeSubscriber = new RemoveSubscriberUseCase(subscriberRepo);
export const authService = new SupabaseAuthService(supabaseUrl, supabaseKey);
export const saveConfig = new SaveConfigUseCase(configRepo);
export const loadConfig = new LoadConfigUseCase(configRepo);
export const saveProfile = new SaveProfileUseCase(profileRepo);
export const loadProfile = new LoadProfileUseCase(profileRepo);
