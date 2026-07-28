import type { Coordinate } from '../../domain/interfaces';

export interface MediaDto {
  id: string;
  ownerId: string;
  url: string;
  createdAt: string; // ISO string — safe to serialize to UI
}

export interface FeedMediaDto {
  id: string;
  url: string;
}

/** One feed entry — the batch of media shared together in a single send. */
export interface FeedPostingDto {
  id: string;
  createdAt: string; // ISO string of the newest item in the posting
  location: string | null;
  /** Where the posting is plotted on the Me-page globe; null when no item has GPS. */
  coordinate: Coordinate | null;
  media: FeedMediaDto[];
}

export interface SubscriberDto {
  id: string;
  publisherId: string;
  contactHandle: string;
  status: 'pending' | 'active' | 'revoked' | 'unreachable';
}

export interface ProfileDto {
  publisherId: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  /** ISO date-only string ("2026-06-14"), or null when the publisher hasn't said. */
  tripStartDate: string | null;
}
