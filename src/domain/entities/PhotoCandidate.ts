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
}
