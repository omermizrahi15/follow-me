import { createClient } from '@supabase/supabase-js';
import type { IPublisherConfigRepository } from '../../domain/interfaces';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { Frequency, PhotoCount } from '../../domain/entities/PublisherConfig';
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
  last_auto_post_at: string | null;
};

interface Database {
  public: {
    Tables: {
      publisher_config: {
        Row: ConfigColumns;
        // last_auto_post_at is server-managed (the cron owns it); the app never writes it.
        Insert: Omit<ConfigColumns, 'expo_push_token' | 'last_auto_post_at'> & {
          expo_push_token?: string | null;
          last_auto_post_at?: string | null;
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
  private client: ReturnType<typeof createClient<Database>>;

  constructor(url: string, anonKey: string) {
    this.client = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
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
}
