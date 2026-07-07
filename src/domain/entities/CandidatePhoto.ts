/**
 * A recent library photo that has been uploaded to the cloud so the server can
 * post it autonomously (the server can't reach the device's library). Persisted
 * in `candidate_photos`, bounded to the publisher's lookback window.
 */
export interface CandidatePhoto {
  publisherId: string;
  /** Device asset id — also used to dedupe against already-sent media. */
  assetId: string;
  /** Public URL of the uploaded copy. */
  url: string;
  /** When the photo was taken. */
  createdAt: Date;
}
