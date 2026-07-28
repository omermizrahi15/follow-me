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
  /**
   * When the posting happened. Defaults to now; the history backfill passes the
   * window's real date so reconstructed trips sort into the feed chronologically
   * instead of piling up at the top (issue #81).
   */
  createdAt?: Date;
  /**
   * Whether to message subscribers. Defaults to true. The history backfill sets
   * it false: reconstructing ten past trips must not fire ten WhatsApp blasts at
   * every follower — those postings are feed-only and discovered in the gallery.
   */
  notify?: boolean;
  /** Marks the posting as reconstructed history rather than a live send. */
  backfilled?: boolean;
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

    const createdAt = input.createdAt ?? new Date();
    const mediaItems = uploads.map(({ item, url }) =>
      Media.create({
        id: item.mediaId,
        ownerId: input.ownerId,
        url,
        createdAt,
        postingId,
        ...(location != null ? { location } : {}),
        // Keep the per-item fix, not just the reverse-geocoded label — the
        // Me-page globe plots the posting at this coordinate (issue #78).
        // Falls back to the place the publisher picked, so a batch of photos
        // with no GPS still lands somewhere real instead of nowhere.
        ...(item.coordinate ?? input.coordinate) != null
          ? { coordinate: (item.coordinate ?? input.coordinate) as Coordinate }
          : {},
        ...(input.backfilled === true ? { backfilled: true } : {}),
      }),
    );

    await Promise.all(mediaItems.map(m => this.mediaRepo.save(m)));

    // Silent postings stop here: no subscriber lookup, no notifier, no delivery
    // rows. Suppressing the send later would still leave 'pending' deliveries
    // that look like failures in the audit trail.
    if (input.notify === false) {
      onProgress?.({ stage: 'notifying', done: 0, total: 0 });
      return mediaItems.map(m => MediaMapper.toDto(m));
    }

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
