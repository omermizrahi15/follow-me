import { Media } from '../../domain/entities/Media';
import type { MediaType } from '../../domain/entities/Media';
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
  mediaType?: MediaType;
  /** Where the photo was taken (from EXIF GPS), when the device provides it. */
  coordinate?: Coordinate;
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
    private readonly geocoder?: IGeocoder,
  ) {}

  async share(input: ShareMediaInput): Promise<MediaDto[]> {
    if (!input.ownerId) throw new Error('ownerId is required');
    // Every item of one share() call carries the same postingId — the feed
    // groups on it to render the batch as a single posting.
    const postingId = `posting-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    // The place lookup runs alongside the uploads — neither waits on the other.
    const [location, uploads] = await Promise.all([
      this.resolveLocation(input.items),
      Promise.all(
        input.items.map(async (item) => ({
          item,
          url: await this.storage.upload(item.localUri, item.filename),
        })),
      ),
    ]);

    const mediaItems = uploads.map(({ item, url }) =>
      Media.create({
        id: item.mediaId,
        ownerId: input.ownerId,
        url,
        createdAt: new Date(),
        postingId,
        ...(item.mediaType != null ? { mediaType: item.mediaType } : {}),
        ...(location != null ? { location } : {}),
      }),
    );

    await Promise.all(mediaItems.map(m => this.mediaRepo.save(m)));

    const subscribers = await this.subscriberRepo.findActiveByPublisher(input.ownerId);
    await Promise.all(subscribers.map(s => this.notifier.notify(s, mediaItems)));

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
