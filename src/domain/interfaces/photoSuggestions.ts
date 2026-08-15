import type { CandidatePhoto } from '../entities/CandidatePhoto';
import type { PhotoCandidate } from '../entities/PhotoCandidate';
import type { PhotoClassification } from '../entities/PhotoClassification';
import type { Coordinate } from './location';

/** Classifies candidate photos into rule categories with confidence/quality. */
export interface IPhotoClassifier {
  /**
   * @param onEach     Called after each photo is classified (index is 1-based,
   *                   total is the full candidate count).
   * @param shouldStop When provided, called after each result. If it returns
   *                   true, classification stops early (batch quota reached).
   */
  classify(
    candidates: PhotoCandidate[],
    onEach?: (result: PhotoClassification, index: number, total: number) => void,
    shouldStop?: () => boolean,
  ): Promise<PhotoClassification[]>;
  /**
   * Whether the *most recent* classify() call was cut short because the day's
   * classification budget is spent. A single classification failing is normal
   * and fails soft (fewer photos); a spent budget means every further call will
   * fail too, so the history backfill must stop rather than grind through its
   * remaining windows producing empty posts (issue #81).
   */
  quotaExhausted?(): boolean;
}

/** Reads photos from the device library within a date window. */
export interface IMediaLibrary {
  /** Photos created within the last `lookbackDays`, newest first. */
  recentPhotos(lookbackDays: number): Promise<PhotoCandidate[]>;
  /**
   * Photos created in `[start, end)`, newest first. The history backfill walks
   * arbitrary past windows (issue #81), which `recentPhotos` — always anchored
   * to now — can't express.
   */
  photosBetween(start: Date, end: Date): Promise<PhotoCandidate[]>;
}

/**
 * Yields the candidate ids that have already been shared, so they're excluded
 * from new suggestions. Backed by the `media` table once a photo has been sent.
 */
export interface ISentPhotoTracker {
  sentCandidateIds(publisherId: string): Promise<Set<string>>;
  /**
   * When the newest photo the publisher has already posted was taken, or null
   * if they have never posted.
   *
   * The suggestion window reaches back to here when they are overdue. A
   * reminder that goes unanswered for two days used to cost them those two
   * days: the window was anchored to *now*, so a weekly publisher opening the
   * app on day nine saw days two through nine and silently lost days one and
   * two — exactly the photos the reminder was about.
   *
   * Deliberately the newest posted *photo* rather than the moment of posting.
   * It is the real boundary: everything after it is material the publisher has
   * never had offered to them, whereas a post's timestamp says nothing about
   * how far back its contents reached.
   */
  newestPostedPhotoAt(publisherId: string): Promise<Date | null>;
}

/**
 * Stores cloud copies of recent library photos so the server can post them
 * autonomously. Deduped by asset id within the publisher's lookback window.
 */
export interface ICandidatePhotoRepository {
  saveMany(photos: CandidatePhoto[]): Promise<void>;
  existingAssetIds(publisherId: string): Promise<Set<string>>;
  /** Most recently created candidate photo URLs (newest first). */
  recentUrls(publisherId: string, limit: number): Promise<string[]>;
  /**
   * Uploaded URL for each of `assetIds`, keyed by asset id. Ids without a cloud
   * copy are absent from the map. Lets a caller holding a device-scanned batch
   * (iOS `ph://` uris) recover the remote copies of *those same* photos.
   */
  urlsByAssetIds(publisherId: string, assetIds: string[]): Promise<Map<string, string>>;
}

/** Resolves a candidate to a uri the storage service can read (e.g. ph:// → file://). */
export type ResolveLocalUri = (candidate: PhotoCandidate) => Promise<string>;

/** Resolves a candidate's GPS coordinate from its asset metadata, or null when
 *  the photo has no location fix (issue #23). */
export type ResolveAssetLocation = (candidate: PhotoCandidate) => Promise<Coordinate | null>;
