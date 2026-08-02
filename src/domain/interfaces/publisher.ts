import type { PublisherConfig } from '../entities/PublisherConfig';
import type { PublisherProfile } from '../entities/PublisherProfile';

/**
 * Why the device is or isn't uploading candidate photos.
 *
 * `active` doubles as the sync heartbeat. The other two are the states that
 * used to be invisible to the server: it saw an empty cloud photo set and asked
 * the user to open the app, when opening the app could not have helped — upload
 * was switched off on the device and only the user could turn it back on.
 */
export type PhotoSyncState = 'active' | 'paused' | 'no-consent';

export interface IPublisherConfigRepository {
  save(config: PublisherConfig): Promise<void>;
  findByPublisher(publisherId: string): Promise<PublisherConfig | null>;
  /**
   * Report what the device's photo sync is doing (issue #97).
   *
   * `active` is written after every successful sync, including one that
   * uploaded nothing — the point is "this phone is syncing", so the server can
   * tell an empty cloud set caused by "no new photos" from one caused by "the
   * app hasn't run in days". `paused`/`no-consent` say upload is off, which
   * needs different push copy again and no grace window at all.
   */
  recordSyncState(publisherId: string, state: PhotoSyncState, at: Date): Promise<void>;
}

export interface IPublisherProfileRepository {
  save(profile: PublisherProfile): Promise<void>;
  findByPublisher(publisherId: string): Promise<PublisherProfile | null>;
}
