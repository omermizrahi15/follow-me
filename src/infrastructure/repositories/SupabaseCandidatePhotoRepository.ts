import { createClient } from '@supabase/supabase-js';
import type { ICandidatePhotoRepository } from '../../domain/interfaces';
import type { CandidatePhoto } from '../../domain/entities/CandidatePhoto';

type CandidateRow = {
  publisher_id: string;
  asset_id: string;
  url: string;
  created_at: string;
  synced_at: string;
  latitude: number | null;
  longitude: number | null;
};

interface Database {
  public: {
    Tables: {
      candidate_photos: {
        Row: CandidateRow;
        Insert: Omit<CandidateRow, 'synced_at'> & { synced_at?: string };
        Update: Partial<CandidateRow>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

export class SupabaseCandidatePhotoRepository implements ICandidatePhotoRepository {
  private client: ReturnType<typeof createClient<Database>>;

  constructor(url: string, anonKey: string) {
    this.client = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
  }

  async saveMany(photos: CandidatePhoto[]): Promise<void> {
    if (photos.length === 0) return;
    const { error } = await this.client.from('candidate_photos').upsert(
      photos.map(p => ({
        publisher_id: p.publisherId,
        asset_id: p.assetId,
        url: p.url,
        created_at: p.createdAt.toISOString(),
        latitude: p.location?.latitude ?? null,
        longitude: p.location?.longitude ?? null,
      })),
      // Explicit conflict target (= the table's primary key) so re-syncing the
      // same asset updates the row regardless of client-library defaults.
      { onConflict: 'publisher_id,asset_id' },
    );
    if (error != null) throw new Error(error.message);
  }

  async existingAssetIds(publisherId: string): Promise<Set<string>> {
    const { data, error } = await this.client
      .from('candidate_photos')
      .select('asset_id')
      .eq('publisher_id', publisherId);
    if (error != null) throw new Error(error.message);
    return new Set(data.map(r => r.asset_id));
  }

  async recentUrls(publisherId: string, limit: number): Promise<string[]> {
    const { data, error } = await this.client
      .from('candidate_photos')
      .select('url')
      .eq('publisher_id', publisherId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error != null) throw new Error(error.message);
    return data.map(r => r.url);
  }
}
