import { SharePhotoUseCase } from '../application/usecases/SharePhotoUseCase';
import { SubscribeUseCase } from '../application/usecases/SubscribeUseCase';
import { WhatsAppNotifier } from '../infrastructure/notifiers/WhatsAppNotifier';
import { SupabasePhotoRepository } from '../infrastructure/repositories/SupabasePhotoRepository';
import { SupabaseSubscriberRepository } from '../infrastructure/repositories/SupabaseSubscriberRepository';
import { CloudinaryStorageService } from '../infrastructure/storage/CloudinaryStorageService';

function requireEnv(key: string): string {
  const value = process.env[key] as string | undefined;
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

const supabaseUrl = requireEnv('EXPO_PUBLIC_SUPABASE_URL');
const supabaseKey = requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');

const photoRepo = new SupabasePhotoRepository(supabaseUrl, supabaseKey);
const subscriberRepo = new SupabaseSubscriberRepository(supabaseUrl, supabaseKey);
const storage = new CloudinaryStorageService(
  requireEnv('EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME'),
  requireEnv('EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET'),
);
const notifier = new WhatsAppNotifier(process.env['WHATSAPP_API_TOKEN'] as string | undefined ?? 'dev-token');

export const sharePhoto = new SharePhotoUseCase(photoRepo, subscriberRepo, notifier, storage);
export const subscribe = new SubscribeUseCase(subscriberRepo);
