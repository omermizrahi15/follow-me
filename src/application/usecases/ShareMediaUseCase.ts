import { Media } from '../../domain/entities/Media';
import type {
  Coordinate,
  IGeocoder,
  IMediaRepository,
  ISubscriberRepository,
  INotifier,
  IStorageService,
} from '../../domain/interfaces';
import { representativeCoordinate } from '../../domain/services/postingLocation';
import { MediaMapper } from '../mappers/MediaMapper';
import type { MediaDto } from '../dtos';

interface MediaItem {
  mediaId: string;
  localUri: string;
  filename: string;
  /** Where the photo was taken (from EXIF GPS), when the device provides it. */
  coordinate?: Coordinate;
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
    private readonly geocoder?: IGeocoder,
  ) {}

  async share(input: ShareMediaInput, onProgress?: (p: ShareProgress) => void): Promise<MediaDto[]> {
    if (!input.ownerId) throw new Error('ownerId is required');
    // Every item of one share() call carries the same postingId — the feed
    // groups on it to render the batch as a single posting.
    const postingId = `posting-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let uploaded = 0;
    onProgress?.({ stage: 'uploading', done: 0, total: input.items.length });
    // The place lookup runs alongside the uploads — neither waits on the other.
    const [location, uploads] = await Promise.all([
      this.resolveLocation(input.items),
      Promise.all(
        input.items.map(async (item) => {
          // Photos from the server-push cache are already hosted remotely — skip re-uploading.
          const isRemote = item.localUri.startsWith('http://') || item.localUri.startsWith('https://');
          const url = isRemote ? item.localUri : await this.storage.upload(item.localUri, item.filename);
          uploaded++;
          onProgress?.({ stage: 'uploading', done: uploaded, total: input.items.length });
          return { item, url };
        }),
      ),
    ]);

    const mediaItems = uploads.map(({ item, url }) =>
      Media.create({
        id: item.mediaId,
        ownerId: input.ownerId,
        url,
        createdAt: new Date(),
        postingId,
        ...(location != null ? { location } : {}),
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

  /**
   * "City, Country" for the batch: the median coordinate of the items that
   * carry GPS, reverse-geocoded once. Null (never a throw) when no item has
   * GPS, no geocoder is wired, or the lookup fails — sharing must not block
   * on naming the place.
   */
  private async resolveLocation(items: MediaItem[]): Promise<string | null> {
    if (this.geocoder == null) return null;
    const coordinate = representativeCoordinate(
      items.map(i => i.coordinate).filter((c): c is Coordinate => c != null),
    );
    if (coordinate == null) return null;
    try {
      return await this.geocoder.reverseGeocode(coordinate);
    } catch {
      return null;
    }
  }
}
