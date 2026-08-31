import type { Coordinate } from '../interfaces';

/**
 * A photo from the publisher's device library that is a candidate for an
 * auto-suggested post, before it has been classified or sent. Kept as a plain
 * value object so the pure selection logic never touches the device or network.
 */
export interface PhotoCandidate {
  /** Stable identifier for the asset (e.g. expo-media-library asset id). */
  id: string;
  /** Local or remote URI used to load/classify the image. */
  uri: string;
  /** When the photo was taken/created — used for recency ordering. */
  createdAt: Date;
  /**
   * Where the photo was taken, from the asset's GPS metadata — absent when the
   * photo has no location fix. Carried to the cloud so the autonomous server
   * job can name the posting's place (issue #23).
   */
  location?: Coordinate;
  /**
   * Pixel dimensions, when the library reported them.
   *
   * Free — they come back with every asset page, no per-photo lookup. Used to
   * turn a file size into a density (see `burstRanking`), which is the only
   * measure of sharpness available without decoding the image or asking a model.
   */
  width?: number;
  height?: number;
  /**
   * The file's size in bytes, when it was worth finding out.
   *
   * Deliberately optional and deliberately sparse: reading it costs a per-asset
   * lookup, so it is fetched only for photos that sit in a multi-photo burst —
   * the only place the comparison is needed. A moment shot once needs no
   * tie-break.
   */
  byteSize?: number;
  /** The publisher hearted this photo. The strongest signal there is. */
  isFavorite?: boolean;
  /**
   * When the publisher last edited it — cropped, straightened, adjusted.
   * Absent when they never touched it beyond taking it.
   */
  editedAt?: Date;
}
