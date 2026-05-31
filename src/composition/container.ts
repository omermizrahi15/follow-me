import { SharePhotoUseCase } from '../application/usecases/SharePhotoUseCase';
import { SubscribeUseCase } from '../application/usecases/SubscribeUseCase';
import { WhatsAppNotifier } from '../infrastructure/notifiers/WhatsAppNotifier';
import {
  InMemoryPhotoRepository,
  InMemorySubscriberRepository,
  InMemoryStorageService,
} from '../infrastructure/InMemoryDoubles';

// Swap these for real implementations as you build them out:
// import { SupabasePhotoRepository } from '../infrastructure/repositories/SupabasePhotoRepository';
// import { CloudinaryStorageService } from '../infrastructure/storage/CloudinaryStorageService';

const photoRepo = new InMemoryPhotoRepository();
const subscriberRepo = new InMemorySubscriberRepository();
const storage = new InMemoryStorageService();
const notifier = new WhatsAppNotifier(process.env.WHATSAPP_API_TOKEN ?? 'dev-token');

export const sharePhoto = new SharePhotoUseCase(photoRepo, subscriberRepo, notifier, storage);
export const subscribe = new SubscribeUseCase(subscriberRepo);
