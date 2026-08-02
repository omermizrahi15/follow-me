import type { CachedPhoto } from '../cache/SuggestionCache';

/**
 * The schema the app's tables present to PostgREST — one definition for the one
 * client (issue #115). Each repository used to carry a `Database` interface
 * describing only its own table, which was fine while each also built its own
 * client; a single shared client needs a single schema type, or every injection
 * site would have to cast the typing away.
 *
 * Only the columns the app reads or writes are declared. Server-managed columns
 * appear as optional on `Insert` where the app must not set them.
 */

type ConfigColumns = {
  publisher_id: string;
  frequency: string;
  photos_per_post: number;
  require_approval: boolean;
  notify_day_of_week: number;
  notify_time: string;
  enabled_categories: string[];
  lookback_days: number;
  min_quality: number;
  timezone: string;
  expo_push_token: string | null;
  last_auto_post_at: string | null;
  /** Device heartbeat for the auto-post grace window — see migration 20240026. */
  last_candidate_sync_at: string | null;
  /** Whether the device is uploading photos at all — see migration 20240027. */
  photo_sync_state: string | null;
};

type CandidateRow = {
  publisher_id: string;
  asset_id: string;
  url: string;
  created_at: string;
  synced_at: string;
  latitude: number | null;
  longitude: number | null;
};

/**
 * A computed approval batch the auto-post job persisted (issue #71). The rich
 * push carries only a `batchId`; the app fetches the full batch + pool so the
 * push payload stays under the APNs 4KB limit. The stored jsonb arrays already
 * match `CachedPhoto`, so they drop straight into SuggestionCache.
 */
type ApprovalBatchRow = {
  batch_id: string;
  publisher_id: string;
  batch: CachedPhoto[];
  pool: CachedPhoto[];
  created_at: string;
  posted_at: string | null;
  posting_id: string | null;
};

type MediaColumns = {
  id: string;
  owner_id: string;
  url: string;
  created_at: string;
  posting_id: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  deleted_at: string | null;
  backfilled: boolean | null;
};

type DeliveryColumns = {
  id: string;
  photo_id: string;
  subscriber_id: string;
  publisher_id: string;
  status: string;
  attempts: number;
  last_attempted_at: string | null;
  created_at: string;
};

type LogColumns = {
  id: string;
  subscriber_id: string | null;
  publisher_id: string;
  contact_handle: string;
  event: string;
  detail: string | null;
  created_at: string;
};

export interface Database {
  public: {
    Tables: {
      media: {
        Row: MediaColumns;
        Insert: Pick<MediaColumns, 'id' | 'owner_id' | 'url' | 'created_at'> &
          Partial<Omit<MediaColumns, 'id' | 'owner_id' | 'url' | 'created_at'>>;
        Update: Partial<MediaColumns>;
        Relationships: [];
      };
      subscribers: {
        Row: { id: string; publisher_id: string; contact_handle: string; status: string };
        Insert: { id: string; publisher_id: string; contact_handle: string; status: string };
        Update: { id?: string; publisher_id?: string; contact_handle?: string; status?: string };
        Relationships: [];
      };
      publisher_config: {
        Row: ConfigColumns;
        // last_auto_post_at is server-managed (the cron owns it); the app never
        // writes it. last_candidate_sync_at and photo_sync_state are the mirror
        // image — device-written, server-read — and never part of a config save.
        Insert: Omit<
          ConfigColumns,
          'expo_push_token' | 'last_auto_post_at' | 'last_candidate_sync_at' | 'photo_sync_state'
        > & {
          expo_push_token?: string | null;
          last_auto_post_at?: string | null;
          last_candidate_sync_at?: string | null;
          photo_sync_state?: string | null;
        };
        Update: Partial<ConfigColumns>;
        Relationships: [];
      };
      candidate_photos: {
        Row: CandidateRow;
        Insert: Omit<CandidateRow, 'synced_at'> & { synced_at?: string };
        Update: Partial<CandidateRow>;
        Relationships: [];
      };
      publisher_profile: {
        Row: { publisher_id: string; display_name: string; avatar_url: string | null; trip_start_date: string | null };
        Insert: { publisher_id: string; display_name: string; avatar_url: string | null; trip_start_date?: string | null };
        Update: { publisher_id?: string; display_name?: string; avatar_url?: string | null; trip_start_date?: string | null };
        Relationships: [];
      };
      approval_batches: {
        Row: ApprovalBatchRow;
        Insert: Omit<ApprovalBatchRow, 'created_at' | 'posted_at' | 'posting_id'> & {
          created_at?: string;
          posted_at?: string | null;
          posting_id?: string | null;
        };
        Update: Partial<ApprovalBatchRow>;
        Relationships: [];
      };
      notification_deliveries: {
        Row: DeliveryColumns;
        Insert: Pick<DeliveryColumns, 'photo_id' | 'subscriber_id' | 'publisher_id'> &
          Partial<Omit<DeliveryColumns, 'photo_id' | 'subscriber_id' | 'publisher_id'>>;
        Update: Partial<Pick<DeliveryColumns, 'status' | 'attempts' | 'last_attempted_at'>>;
        Relationships: [];
      };
      notification_log: {
        Row: LogColumns;
        Insert: Pick<LogColumns, 'publisher_id' | 'contact_handle' | 'event'> &
          Partial<Omit<LogColumns, 'publisher_id' | 'contact_handle' | 'event'>>;
        // Append-only: the compliance audit is never edited.
        Update: { [_ in never]: never };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}
