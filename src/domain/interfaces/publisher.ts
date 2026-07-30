import type { PublisherConfig } from '../entities/PublisherConfig';
import type { PublisherProfile } from '../entities/PublisherProfile';

export interface IPublisherConfigRepository {
  save(config: PublisherConfig): Promise<void>;
  findByPublisher(publisherId: string): Promise<PublisherConfig | null>;
  /**
   * Heartbeat: the device finished a candidate-photo sync (issue #97). Written
   * even when nothing was uploaded — the point is "this phone is syncing", so
   * the server can tell an empty cloud set caused by "no new photos" from one
   * caused by "the app hasn't run in days". The two need different push copy.
   */
  recordCandidateSync(publisherId: string, at: Date): Promise<void>;
}

export interface IPublisherProfileRepository {
  save(profile: PublisherProfile): Promise<void>;
  findByPublisher(publisherId: string): Promise<PublisherProfile | null>;
}
