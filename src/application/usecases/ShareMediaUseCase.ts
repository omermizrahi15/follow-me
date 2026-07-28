import { Media } from '../../domain/entities/Media';
import type {
  Coordinate,
  IGeocoder,
  IMediaRepository,
  ISubscriberRepository,
  INotifier,
  INotificationLogger,
  IStorageService,
} from '../../domain/interfaces';
import { resolvePostingPlace } from '../services/resolvePostingPlace';
import { mapInBatches, PHOTO_UPLOAD_BATCH_SIZE } from '../services/mapInBatches';
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
  /**
   * Explicit place chosen/edited by the publisher. When set it is used as-is
   * ('' or whitespace → no place); when undefined the place is auto-resolved
   * from the items' GPS coordinates.
   */
  location?: string | null;
  /**
   * Where the publisher said the posting happened, when they picked a place
   * because their photos carried no GPS. Used only for items that have no fix
   * of their own — a real EXIF coordinate is always more precise than a city
   * centre, so it is never overridden.
   */
  coordinate?: Coordinate;
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
    private readonly deliveryLog?: INotificationLogger,
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
      this.resolveLocation(input),
      // A few at a time, never all at once: the picker lets the publisher select
      // an unlimited number of photos, and each upload decodes a full-resolution
      // bitmap to downscale it. Uploading a whole selection concurrently is what
      // the iOS watchdog kills the app for (issue #77).
      //
      // Uploads within a batch finish in whatever order the network returns, so
      // `done` counts completions, not positions — it rises monotonically to
      // `total` but says nothing about which item just landed.
      mapInBatches(input.items, PHOTO_UPLOAD_BATCH_SIZE, async (item) => {
        // Photos from the server-push cache are already hosted remotely — skip re-uploading.
        const isRemote = item.localUri.startsWith('http://') || item.localUri.startsWith('https://');
        const url = isRemote ? item.localUri : await this.storage.upload(item.localUri, item.filename);
        uploaded++;
        onProgress?.({ stage: 'uploading', done: uploaded, total: input.items.length });
        return { item, url };
      }),
    ]);

    const mediaItems = uploads.map(({ item, url }) =>
      Media.create({
        id: item.mediaId,
        ownerId: input.ownerId,
        url,
        createdAt: new Date(),
        postingId,
        ...(location != null ? { location } : {}),
        // Keep the per-item fix, not just the reverse-geocoded label — the
        // Me-page globe plots the posting at this coordinate (issue #78).
        // Falls back to the place the publisher picked, so a batch of photos
        // with no GPS still lands somewhere real instead of nowhere.
        ...(item.coordinate ?? input.coordinate) != null
          ? { coordinate: (item.coordinate ?? input.coordinate) as Coordinate }
          : {},
      }),
    );

    await Promise.all(mediaItems.map(m => this.mediaRepo.save(m)));

    const subscribers = await this.subscriberRepo.findActiveByPublisher(input.ownerId);
    onProgress?.({ stage: 'notifying', done: 0, total: subscribers.length });
    const photoIds = mediaItems.map(m => m.id);
    // Every (photo, subscriber) pair starts as 'pending' before any send, so a
    // crash mid-share still leaves a trace of what was never delivered.
    await this.safeLog(() =>
      this.deliveryLog?.logPending(
        subscribers.flatMap(s =>
          photoIds.map(photoId => ({ photoId, subscriberId: s.id, publisherId: input.ownerId })),
        ),
      ),
    );
    let notified = 0;
    await Promise.all(subscribers.map(async s => {
      try {
        await this.notifier.notify(s, mediaItems);
        await this.safeLog(() => this.deliveryLog?.markSent(photoIds, s.id));
      } catch {
        // The notifier has already exhausted its retries by the time it
        // throws. Record the failure instead of rethrowing — one unreachable
        // subscriber must not fail the whole share.
        await this.safeLog(() => this.deliveryLog?.markFailed(photoIds, s.id));
      }
      notified++;
      onProgress?.({ stage: 'notifying', done: notified, total: subscribers.length });
    }));

    return mediaItems.map(m => MediaMapper.toDto(m));
  }

  /** Delivery logging is best-effort: a broken log must never block a share. */
  private async safeLog(fn: () => Promise<void> | undefined): Promise<void> {
    try {
      await fn();
    } catch {
      // Worst case a row stays 'pending' — acceptable for an audit trail.
    }
  }

  /**
   * "City, Country" for the batch: the median coordinate of the items that
   * carry GPS, reverse-geocoded once. Null (never a throw) when no item has
   * GPS, no geocoder is wired, or the lookup fails — sharing must not block
   * on naming the place.
   */
  private async resolveLocation(input: ShareMediaInput): Promise<string | null> {
    // The publisher's explicit choice wins over GPS auto-resolution.
    if (input.location !== undefined) {
      const trimmed = input.location?.trim() ?? '';
      return trimmed === '' ? null : trimmed;
    }
    if (this.geocoder == null) return null;
    return resolvePostingPlace(
      this.geocoder,
      input.items.map(i => i.coordinate).filter((c): c is Coordinate => c != null),
    );
  }
}
