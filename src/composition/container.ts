import { SharePhotoUseCase } from '../application/usecases/SharePhotoUseCase';
import { SubscribeUseCase } from '../application/usecases/SubscribeUseCase';
import { WhatsAppNotifier } from '../infrastructure/notifiers/WhatsAppNotifier';
import {
  InMemoryPhotoRepository,
  InMemorySubscriberRepository,
  InMemoryStorageService,
} from '../infrastructure/InMemoryDoubles';

const photoRepo = new InMemoryPhotoRepository();
const subscriberRepo = new InMemorySubscriberRepository();
const storage = new InMemoryStorageService();

const apiToken = (process.env['WHATSAPP_API_TOKEN'] ?? 'dev-token') as string;
const notifier = new WhatsAppNotifier(apiToken);

export const sharePhoto = new SharePhotoUseCase(photoRepo, subscriberRepo, notifier, storage);
export const subscribe = new SubscribeUseCase(subscriberRepo);