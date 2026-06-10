import { createClient } from '@supabase/supabase-js';
import type { IPhotoRepository } from '../../domain/interfaces';
import { Photo } from '../../domain/entities/Photo';

interface Database {
  public: {
    Tables: {
      photos: {
        Row: { id: string; owner_id: string; url: string; created_at: string };
        Insert: { id: string; owner_id: string; url: string; created_at: string };
        Update: { id?: string; owner_id?: string; url?: string; created_at?: string };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

type PhotoRow = Database['public']['Tables']['photos']['Row'];

function rowToPhoto(row: PhotoRow): Photo {
  return Photo.create({ id: row.id, ownerId: row.owner_id, url: row.url, createdAt: new Date(row.created_at) });
}

export class SupabasePhotoRepository implements IPhotoRepository {
  private client: ReturnType<typeof createClient<Database>>;

  constructor(url: string, anonKey: string) {
    this.client = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
  }

  async save(photo: Photo): Promise<void> {
    const { error } = await this.client.from('photos').upsert({
      id: photo.id,
      owner_id: photo.ownerId,
      url: photo.url,
      created_at: photo.createdAt.toISOString(),
    });
    if (error != null) throw new Error(error.message);
  }

  async findByOwner(ownerId: string): Promise<Photo[]> {
    const { data, error } = await this.client
      .from('photos')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false });
    if (error != null) throw new Error(error.message);
    return data.map(rowToPhoto);
  }

  async findById(id: string): Promise<Photo | null> {
    const { data, error } = await this.client
      .from('photos')
      .select('*')
      .eq('id', id)
      .single();
    if (error != null) return null;
    return rowToPhoto(data);
  }
}
