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

export interface ShareProgress {
  /** 'uploading' = photos → cloud storage; 'notifying' = messages → subscribers. */
  stage: 'uploading' | 'notifying';
  done: number;
  total: number;
}

export class ShareMediaUseCase {
  constructor(
    private readonly mediaRepo: IMediaRepository,
    private readonly subscriberRepo: ISubscriberRepository,
    private readonly notifier: INotifier,
    private readonly storage: IStorageService,
  ) {}

  async share(input: ShareMediaInput, onProgress?: (p: ShareProgress) => void): Promise<MediaDto[]> {
    if (!input.ownerId) throw new Error('ownerId is required');
    let uploaded = 0;
    onProgress?.({ stage: 'uploading', done: 0, total: input.items.length });
    const mediaItems = await Promise.all(
      input.items.map(async (item) => {
        // Photos from the server-push cache are already hosted remotely — skip re-uploading.
        const isRemote = item.localUri.startsWith('http://') || item.localUri.startsWith('https://');
        const url = isRemote ? item.localUri : await this.storage.upload(item.localUri, item.filename);
        uploaded++;
        onProgress?.({ stage: 'uploading', done: uploaded, total: input.items.length });
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
    onProgress?.({ stage: 'notifying', done: 0, total: subscribers.length });
    let notified = 0;
    await Promise.all(subscribers.map(async s => {
      await this.notifier.notify(s, mediaItems);
      notified++;
      onProgress?.({ stage: 'notifying', done: notified, total: subscribers.length });
    }));

    return mediaItems.map(m => MediaMapper.toDto(m));
  }
}
