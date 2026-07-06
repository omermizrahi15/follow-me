import { Media } from '../../domain/entities/Media';
import type { MediaType } from '../../domain/entities/Media';
import type {
  IMediaRepository,
  ISubscriberRepository,
  INotifier,
  IStorageService,
} from '../../domain/interfaces';
import { MediaMapper } from '../mappers/MediaMapper';
import type { MediaDto } from '../dtos';

interface MediaItem {
  mediaId: string;
  localUri: string;
  filename: string;
  mediaType?: MediaType;
}

export interface ShareMediaInput {
  ownerId: string;
  items: MediaItem[];
}

export class ShareMediaUseCase {
  constructor(
    private readonly mediaRepo: IMediaRepository,
    private readonly subscriberRepo: ISubscriberRepository,
    private readonly notifier: INotifier,
    private readonly storage: IStorageService,
  ) {}

  async share(input: ShareMediaInput): Promise<MediaDto[]> {
    if (!input.ownerId) throw new Error('ownerId is required');
    const mediaItems = await Promise.all(
      input.items.map(async (item) => {
        // Photos from the server-push cache are already hosted remotely — skip re-uploading.
        const isRemote = item.localUri.startsWith('http://') || item.localUri.startsWith('https://');
        const url = isRemote ? item.localUri : await this.storage.upload(item.localUri, item.filename);
        return Media.create({
          id: item.mediaId,
          ownerId: input.ownerId,
          url,
          createdAt: new Date(),
          ...(item.mediaType != null ? { mediaType: item.mediaType } : {}),
        });
      }),
    );

    await Promise.all(mediaItems.map(m => this.mediaRepo.save(m)));

    const subscribers = await this.subscriberRepo.findActiveByPublisher(input.ownerId);
    await Promise.all(subscribers.map(s => this.notifier.notify(s, mediaItems)));

    return mediaItems.map(m => MediaMapper.toDto(m));
  }
}
