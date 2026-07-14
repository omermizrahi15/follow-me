import { createClient } from '@supabase/supabase-js';
import type { IMediaRepository } from '../../domain/interfaces';
import { Media } from '../../domain/entities/Media';
import { parseSong } from '../../domain/entities/Song';

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
          song: unknown;
        };
        Insert: {
          id: string;
          owner_id: string;
          url: string;
          created_at: string;
          posting_id?: string | null;
          location?: string | null;
          song?: unknown;
        };
        Update: {
          id?: string;
          owner_id?: string;
          url?: string;
          created_at?: string;
          posting_id?: string | null;
          location?: string | null;
          song?: unknown;
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
  // parseSong guards against malformed jsonb — a bad song column must not
  // break the whole feed, it just renders without a music bar.
  const song = parseSong(row.song);
  return Media.create({
    id: row.id,
    ownerId: row.owner_id,
    url: row.url,
    createdAt: new Date(row.created_at),
    ...(row.posting_id != null ? { postingId: row.posting_id } : {}),
    ...(row.location != null ? { location: row.location } : {}),
    ...(song != null ? { song } : {}),
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
      song: media.song ?? null,
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
