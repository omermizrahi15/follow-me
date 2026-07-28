import type { Coordinate } from '../../domain/interfaces';

/**
 * The shapes the feed is rendered from. They live here rather than beside one
 * of the components that draws them: the Me sheet's cards, the story viewer and
 * the globe all consume the same posting, and hanging the types off whichever
 * component happened to be written first made it look like there were two
 * different feeds.
 */

/** A single photo within a posting. Mirrors the domain `Media`. */
export interface FeedMedia {
  id: string;
  uri?: string;
}

/** A "posting" — the batch of media sent together, with its date and place. */
export interface FeedPosting {
  id: string;
  /** Pre-formatted date label, e.g. "June 18, 2026". */
  date: string;
  /** ISO timestamp — the globe orders the route chronologically on it. */
  createdAt: string;
  /** Place label, e.g. "Lisbon, Portugal". */
  place?: string;
  /** Where it was taken; absent when no photo in the batch had a GPS fix. */
  coordinate?: Coordinate;
  /** Cover image shown for the post (falls back to the first media). */
  coverUri?: string;
  media: FeedMedia[];
}
