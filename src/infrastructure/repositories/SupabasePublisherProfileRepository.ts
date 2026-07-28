import { createClient } from '@supabase/supabase-js';
import type { IPublisherProfileRepository } from '../../domain/interfaces';
import { PublisherProfile } from '../../domain/entities/PublisherProfile';

interface Database {
  public: {
    Tables: {
      publisher_profile: {
        Row: { publisher_id: string; display_name: string; avatar_url: string | null };
        Insert: { publisher_id: string; display_name: string; avatar_url: string | null };
        Update: { publisher_id?: string; display_name?: string; avatar_url?: string | null };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

type ProfileRow = Database['public']['Tables']['publisher_profile']['Row'];

function rowToProfile(row: ProfileRow): PublisherProfile {
  return PublisherProfile.create({
    publisherId: row.publisher_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  });
}

export class SupabasePublisherProfileRepository implements IPublisherProfileRepository {
  private client: ReturnType<typeof createClient<Database>>;

  constructor(url: string, anonKey: string) {
    this.client = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
  }

  async save(profile: PublisherProfile): Promise<void> {
    const { error } = await this.client.from('publisher_profile').upsert({
      publisher_id: profile.publisherId,
      display_name: profile.displayName,
      avatar_url: profile.avatarUrl,
    });
    if (error != null) throw new Error(error.message);
  }

  async findByPublisher(publisherId: string): Promise<PublisherProfile | null> {
    const { data, error } = await this.client
      .from('publisher_profile')
      .select('*')
      .eq('publisher_id', publisherId)
      .single();
    if (error != null) return null;
    return rowToProfile(data);
  }
}
