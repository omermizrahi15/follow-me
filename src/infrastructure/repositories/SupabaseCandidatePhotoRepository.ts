import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database';
import type { ICandidatePhotoRepository } from '../../domain/interfaces';
import type { CandidatePhoto } from '../../domain/entities/CandidatePhoto';

export class SupabaseCandidatePhotoRepository implements ICandidatePhotoRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

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

  async urlsByAssetIds(publisherId: string, assetIds: string[]): Promise<Map<string, string>> {
    if (assetIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from('candidate_photos')
      .select('asset_id, url')
      .eq('publisher_id', publisherId)
      .in('asset_id', assetIds);
    if (error != null) throw new Error(error.message);
    return new Map(data.map(r => [r.asset_id, r.url]));
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
