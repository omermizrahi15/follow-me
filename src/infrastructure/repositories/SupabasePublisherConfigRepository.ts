import { createClient } from '@supabase/supabase-js';
import type { IPublisherConfigRepository } from '../../domain/interfaces';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { Frequency, PhotoCount } from '../../domain/entities/PublisherConfig';

interface Database {
  public: {
    Tables: {
      publisher_config: {
        Row: { publisher_id: string; frequency: string; photos_per_post: number; require_approval: boolean };
        Insert: { publisher_id: string; frequency: string; photos_per_post: number; require_approval: boolean };
        Update: { publisher_id?: string; frequency?: string; photos_per_post?: number; require_approval?: boolean };
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

function rowToConfig(row: ConfigRow): PublisherConfig {
  return PublisherConfig.create({
    publisherId: row.publisher_id,
    frequency: row.frequency as Frequency,
    photosPerPost: row.photos_per_post as PhotoCount,
    requireApproval: row.require_approval,
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
