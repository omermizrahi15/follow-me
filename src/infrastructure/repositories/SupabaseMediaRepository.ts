import { createClient } from '@supabase/supabase-js';
import type { IMediaRepository } from '../../domain/interfaces';
import { Media } from '../../domain/entities/Media';

interface Database {
  public: {
    Tables: {
      media: {
        Row: {
          id: string;
          owner_id: string;
          url: string;
          created_at: string;
          media_type: string;
          posting_id: string | null;
          location: string | null;
        };
        Insert: {
          id: string;
          owner_id: string;
          url: string;
          created_at: string;
          media_type?: string;
          posting_id?: string | null;
          location?: string | null;
        };
        Update: {
          id?: string;
          owner_id?: string;
          url?: string;
          created_at?: string;
          media_type?: string;
          posting_id?: string | null;
          location?: string | null;
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
  return Media.create({
    id: row.id,
    ownerId: row.owner_id,
    url: row.url,
    createdAt: new Date(row.created_at),
    mediaType: row.media_type === 'video' ? 'video' : 'image',
    ...(row.posting_id != null ? { postingId: row.posting_id } : {}),
    ...(row.location != null ? { location: row.location } : {}),
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
      media_type: media.mediaType,
      posting_id: media.postingId ?? null,
      location: media.location ?? null,
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
