import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database';
import type { IPublisherConfigRepository, PhotoSyncState } from '../../domain/interfaces';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { Frequency, PhotoCount } from '../../domain/entities/PublisherConfig';
import type { PhotoCategory } from '../../domain/entities/PhotoClassification';
import { SELECTABLE_CATEGORIES } from '../../domain/entities/PhotoClassification';

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
  });
}

export class SupabasePublisherConfigRepository implements IPublisherConfigRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

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
