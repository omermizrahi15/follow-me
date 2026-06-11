import { ShareMediaUseCase } from '../application/usecases/ShareMediaUseCase';
import { SubscribeUseCase } from '../application/usecases/SubscribeUseCase';
import { WhatsAppNotifier } from '../infrastructure/notifiers/WhatsAppNotifier';
import { WhatsAppConfirmationSender } from '../infrastructure/notifiers/WhatsAppConfirmationSender';
import { TwilioClientAdapter } from '../infrastructure/notifiers/TwilioClientAdapter';
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
const twilioClient = new TwilioClientAdapter(
  requireEnv('TWILIO_ACCOUNT_SID'),
  requireEnv('TWILIO_AUTH_TOKEN'),
  requireEnv('TWILIO_WHATSAPP_FROM'),
);
const notifier = new WhatsAppNotifier(twilioClient, 'Omer'); // replace with auth user display name once #2 is done

const confirmationSender = new WhatsAppConfirmationSender(twilioClient);

export const shareMedia = new ShareMediaUseCase(mediaRepo, subscriberRepo, notifier, storage);
export const subscribe = new SubscribeUseCase(subscriberRepo, confirmationSender);
