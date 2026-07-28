import type { Coordinate } from '../../domain/interfaces';
import type { FeedPostingDto } from '../../application/dtos';

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
  /** ISO timestamp of when it was moved to the trash; absent while it is live. */
  deletedAt?: string;
  media: FeedMedia[];
}

/** e.g. "June 18, 2026" — the label the feed and the story viewer both show. */
export function formatPostingDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Application DTO → the shape the UI renders. Lives here beside the types
 * rather than in the feed hook: the story viewer resolves a posting by id when
 * it is opened from the "Posted ✅" push, and has to build the same object.
 */
export function toFeedPosting(dto: FeedPostingDto): FeedPosting {
  return {
    id: dto.id,
    date: formatPostingDate(dto.createdAt),
    createdAt: dto.createdAt,
    media: dto.media.map(m => ({ id: m.id, uri: m.url })),
    ...(dto.location != null ? { place: dto.location } : {}),
    ...(dto.coordinate != null ? { coordinate: dto.coordinate } : {}),
    ...(dto.deletedAt != null ? { deletedAt: dto.deletedAt } : {}),
  };
}
