import { createClient } from '@supabase/supabase-js';
import type { IMediaRepository } from '../../domain/interfaces';
import { Media } from '../../domain/entities/Media';
import { validCoordinate } from '../../domain/services/coordinate';

interface Database {
  public: {
    Tables: {
      media: {
        Row: {
          id: string;
          owner_id: string;
          url: string;
          created_at: string;
          posting_id: string | null;
          location: string | null;
          latitude: number | null;
          longitude: number | null;
          backfilled: boolean | null;
        };
        Insert: {
          id: string;
          owner_id: string;
          url: string;
          created_at: string;
          posting_id?: string | null;
          location?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          backfilled?: boolean | null;
        };
        Update: {
          id?: string;
          owner_id?: string;
          url?: string;
          created_at?: string;
          posting_id?: string | null;
          location?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          backfilled?: boolean | null;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

type MediaRow = Database['public']['Tables']['media']['Row'];

function rowToMedia(row: MediaRow): Media {
  // Re-validate on read rather than trusting the column: rows predating
  // 20240022 are null, and a defaulted/garbage pair (0,0 or out of range)
  // would otherwise put a photo marker in the Gulf of Guinea.
  // ("defaulted" here is about the coordinate columns — unrelated to the
  // `backfilled` flag below, which marks reconstructed history.)
  const coordinate =
    row.latitude != null && row.longitude != null
      ? validCoordinate(row.latitude, row.longitude)
      : null;
  return Media.create({
    id: row.id,
    ownerId: row.owner_id,
    url: row.url,
    createdAt: new Date(row.created_at),
    ...(row.posting_id != null ? { postingId: row.posting_id } : {}),
    ...(row.location != null ? { location: row.location } : {}),
    ...(coordinate != null ? { coordinate } : {}),
    ...(row.backfilled === true ? { backfilled: true } : {}),
  });
}

export class SupabaseMediaRepository implements IMediaRepository {
  private client: ReturnType<typeof createClient<Database>>;

  constructor(url: string, anonKey: string) {
    this.client = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
  }

  async save(media: Media): Promise<void> {
    const { error } = await this.client.from('media').upsert({
      id: media.id,
      owner_id: media.ownerId,
      url: media.url,
      created_at: media.createdAt.toISOString(),
      posting_id: media.postingId ?? null,
      location: media.location ?? null,
      latitude: media.coordinate?.latitude ?? null,
      longitude: media.coordinate?.longitude ?? null,
      // Only sent when true, so a live post never depends on migration 20240023
      // having landed — the column defaults to false anyway. Keeps ordinary
      // sharing working on any environment the migration hasn't reached yet.
      ...(media.backfilled ? { backfilled: true } : {}),
    });
    if (error != null) throw new Error(error.message);
  }

  async findByOwner(ownerId: string): Promise<Media[]> {
    const { data, error } = await this.client
      .from('media')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false });
    if (error != null) throw new Error(error.message);
    return data.map(rowToMedia);
  }

  async findById(id: string): Promise<Media | null> {
    const { data, error } = await this.client
      .from('media')
      .select('*')
      .eq('id', id)
      .single();
    if (error != null) return null;
    return rowToMedia(data);
  }
}
