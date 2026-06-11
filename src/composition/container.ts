import { ShareMediaUseCase } from '../application/usecases/ShareMediaUseCase';
import { SubscribeUseCase } from '../application/usecases/SubscribeUseCase';
import { ConsoleNotifier } from '../infrastructure/notifiers/ConsoleNotifier';
import { SupabaseAuthService } from '../infrastructure/auth/SupabaseAuthService';
import { SupabaseMediaRepository } from '../infrastructure/repositories/SupabaseMediaRepository';
import { SupabaseSubscriberRepository } from '../infrastructure/repositories/SupabaseSubscriberRepository';
import { CloudinaryStorageService } from '../infrastructure/storage/CloudinaryStorageService';

function requireEnv(key: string): string {
  const value = process.env[key] as string | undefined;
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

const supabaseUrl = requireEnv('EXPO_PUBLIC_SUPABASE_URL');
const supabaseKey = requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');

const mediaRepo = new SupabaseMediaRepository(supabaseUrl, supabaseKey);
const subscriberRepo = new SupabaseSubscriberRepository(supabaseUrl, supabaseKey);
const storage = new CloudinaryStorageService(
  requireEnv('EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME'),
  requireEnv('EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET'),
);
// TODO(#24): replace with WhatsAppNotifier once notifications move server-side
const notifier = new ConsoleNotifier('Omer');

export const shareMedia = new ShareMediaUseCase(mediaRepo, subscriberRepo, notifier, storage);
export const subscribe = new SubscribeUseCase(subscriberRepo);
export const authService = new SupabaseAuthService(supabaseUrl, supabaseKey);
