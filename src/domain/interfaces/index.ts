/**
 * The domain's ports, grouped by area. This barrel is the import surface for
 * the rest of the app — add a new port to the file it belongs to, not here.
 */
export type { IMediaRepository, MediaWindow, IPostGalleryRepository, IStorageService } from './media';
export type { ISubscriberRepository, IConfirmationSender } from './subscribers';
export type { IContactsDirectory, ContactsPermission, DeviceContact } from './contacts';
export type {
  INotifier,
  NotificationEvent,
  NotificationLogEntry,
  RecordedNotificationLogEntry,
  INotificationLog,
  DeliveryStatus,
  NotificationDelivery,
  RecordedNotificationDelivery,
  INotificationLogger,
} from './messaging';
export type { ReminderSchedule, INotificationScheduler } from './reminders';
export type { Coordinate, IGeocoder, PlaceSuggestion, IPlaceSearch } from './location';
export type { ConnectionReading, IConnectivitySource } from './connectivity';
export type {
  FaceReference,
  IPhotoClassifier,
  IMediaLibrary,
  ISentPhotoTracker,
  ICandidatePhotoRepository,
  ResolveLocalUri,
  ResolveAssetLocation,
} from './photoSuggestions';
export type { IClassificationStore } from './classificationStore';
export type {
  IPublisherConfigRepository,
  IPublisherProfileRepository,
  PhotoSyncState,
} from './publisher';
export type { IAiUsageReader } from './aiUsage';
