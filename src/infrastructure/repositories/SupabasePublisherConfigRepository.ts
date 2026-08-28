import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppSupabaseClient } from '../supabase/types';
import type { IPublisherConfigRepository, PhotoSyncState } from '../../domain/interfaces';
import { PHOTOS_OF_ME_MODES, PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { Frequency, PhotoCount, PhotosOfMe } from '../../domain/entities/PublisherConfig';
import type { PhotoCategory } from '../../domain/entities/PhotoClassification';
import { SELECTABLE_CATEGORIES } from '../../domain/entities/PhotoClassification';

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
  /** "photos of me" preference — see migration 20240035. */
  photos_of_me: string | null;
  last_auto_post_at: string | null;
  /** Device heartbeat for the auto-post grace window — see migration 20240026. */
  last_candidate_sync_at: string | null;
  /** Whether the device is uploading photos at all — see migration 20240027. */
  photo_sync_state: string | null;
};

interface Database {
  public: {
    Tables: {
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
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

type ConfigRow = Database['public']['Tables']['publisher_config']['Row'];

/**
 * Keep only categories the app still supports, dropping retired ones (e.g. legacy
 * 'view_only'/'activity') that older rows or the old DB default may still carry.
 * Falls back to all selectable categories when nothing valid remains, so a scan
 * never silently returns zero photos.
 */
function sanitizeCategories(raw: unknown): PhotoCategory[] {
  const kept = Array.isArray(raw)
    ? raw.filter((c): c is PhotoCategory => SELECTABLE_CATEGORIES.includes(c as PhotoCategory))
    : [];
  return kept.length > 0 ? kept : [...SELECTABLE_CATEGORIES];
}

/** The stored preference, or 'off' for null / anything unrecognised. */
function asPhotosOfMe(raw: unknown): PhotosOfMe {
  return PHOTOS_OF_ME_MODES.includes(raw as PhotosOfMe) ? (raw as PhotosOfMe) : 'off';
}

function rowToConfig(row: ConfigRow): PublisherConfig {
  return PublisherConfig.create({
    publisherId: row.publisher_id,
    frequency: row.frequency as Frequency,
    photosPerPost: row.photos_per_post as PhotoCount,
    requireApproval: row.require_approval,
    notifyDayOfWeek: row.notify_day_of_week,
    notifyTime: row.notify_time,
    // Guard against null/empty from older rows or manual edits — an empty
    // category list would make every scan return nothing. Also drop any
    // retired categories (e.g. legacy 'view_only'/'activity') so PublisherConfig
    // validation doesn't reject an otherwise-valid row.
    enabledCategories: sanitizeCategories(row.enabled_categories),
    // lookbackDays is now derived from frequency — not read from DB
    minQuality: row.min_quality,
    timezone: row.timezone,
    expoPushToken: row.expo_push_token ?? '',
    // Narrowed rather than trusted: PublisherConfig rejects an unknown value,
    // and a row written by a newer app version (or edited by hand) must not
    // make the whole config unloadable over one optional preference.
    photosOfMe: asPhotosOfMe(row.photos_of_me),
  });
}

export class SupabasePublisherConfigRepository implements IPublisherConfigRepository {
  private readonly client: SupabaseClient<Database>;

  // Takes the shared authenticated client (issue #115): its session is what puts
  // `auth.uid()` behind every query, which is what the RLS policies match on.
  constructor(client: AppSupabaseClient) {
    this.client = client as unknown as SupabaseClient<Database>;
  }

  async save(config: PublisherConfig): Promise<void> {
    const { error } = await this.client.from('publisher_config').upsert({
      publisher_id: config.publisherId,
      frequency: config.frequency,
      photos_per_post: config.photosPerPost,
      require_approval: config.requireApproval,
      notify_day_of_week: config.notifyDayOfWeek,
      notify_time: config.notifyTime,
      enabled_categories: config.enabledCategories,
      lookback_days: config.lookbackDays,
      min_quality: config.minQuality,
      timezone: config.timezone,
      expo_push_token: config.expoPushToken === '' ? null : config.expoPushToken,
      photos_of_me: config.photosOfMe,
    });
    if (error != null) throw new Error(error.message);
  }

  async findByPublisher(publisherId: string): Promise<PublisherConfig | null> {
    const { data, error } = await this.client
      .from('publisher_config')
      .select('*')
      .eq('publisher_id', publisherId)
      .single();
    if (error != null) return null;
    return rowToConfig(data);
  }

  /**
   * Updates only the sync-state columns, and only for an existing row — an
   * upsert here could resurrect a config the user deleted, or write a
   * half-populated row for a publisher who never finished setup.
   *
   * The heartbeat moves only for `active`: a paused device has not synced, and
   * stamping it would tell the server the opposite of what happened.
   */
  async recordSyncState(publisherId: string, state: PhotoSyncState, at: Date): Promise<void> {
    const { error } = await this.client
      .from('publisher_config')
      .update({
        photo_sync_state: state,
        ...(state === 'active' ? { last_candidate_sync_at: at.toISOString() } : {}),
      })
      .eq('publisher_id', publisherId);
    if (error != null) throw new Error(error.message);
  }
}
