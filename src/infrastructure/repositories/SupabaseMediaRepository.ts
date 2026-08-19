import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppSupabaseClient } from '../supabase/types';
import type { IMediaRepository, MediaWindow } from '../../domain/interfaces';
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
          deleted_at: string | null;
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
          deleted_at?: string | null;
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
          deleted_at?: string | null;
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
type MediaInsert = Database['public']['Tables']['media']['Insert'];

function mediaToRow(media: Media): MediaInsert {
  return {
    id: media.id,
    owner_id: media.ownerId,
    url: media.url,
    created_at: media.createdAt.toISOString(),
    posting_id: media.postingId ?? null,
    location: media.location ?? null,
    latitude: media.coordinate?.latitude ?? null,
    longitude: media.coordinate?.longitude ?? null,
    // Both flags are sent only when set, so a live post never depends on
    // migration 20240029/20240030 having landed — the columns default to
    // false/null anyway. Keeps ordinary sharing working on any environment
    // the migrations haven't reached yet. Restoring clears deleted_at through
    // setPostingDeleted, not here: writes here only ever carry fresh media.
    ...(media.deletedAt != null ? { deleted_at: media.deletedAt.toISOString() } : {}),
    ...(media.backfilled ? { backfilled: true } : {}),
  };
}

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
    ...(row.deleted_at != null ? { deletedAt: new Date(row.deleted_at) } : {}),
    ...(row.backfilled === true ? { backfilled: true } : {}),
  });
}

export class SupabaseMediaRepository implements IMediaRepository {
  private readonly client: SupabaseClient<Database>;

  // Takes the shared authenticated client (issue #115): its session is what puts
  // `auth.uid()` behind every query, which is what the RLS policies match on.
  constructor(client: AppSupabaseClient) {
    this.client = client as unknown as SupabaseClient<Database>;
  }

  async saveMany(media: Media[]): Promise<void> {
    if (media.length === 0) return;
    // One statement for the batch: Postgres applies it whole or not at all, so
    // a failure cannot leave half a posting stored (issue #116).
    const { error } = await this.client.from('media').upsert(media.map(mediaToRow));
    if (error != null) throw new Error(error.message);
  }

  async findByOwner(ownerId: string, window: MediaWindow): Promise<Media[]> {
    const offset = window.offset ?? 0;
    const { data, error } = await this.client
      .from('media')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
      // Every photo of a posting is written with the same created_at, so that
      // column alone leaves whole batches tied. Paging over a non-deterministic
      // order silently repeats some rows and skips others; the id breaks the
      // tie the same way on every request.
      .order('id', { ascending: true })
      .range(offset, offset + window.limit - 1);
    if (error != null) throw new Error(error.message);
    return data.map(rowToMedia);
  }

  async findByPosting(ownerId: string, postingId: string): Promise<Media[]> {
    const { data, error } = await this.client
      .from('media')
      .select('*')
      // Owner-scoped like every other read: a posting id must not be enough.
      .eq('owner_id', ownerId)
      .eq('posting_id', postingId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true });
    if (error != null) throw new Error(error.message);
    return data.map(rowToMedia);
  }

  async postedAssetIds(ownerId: string): Promise<Set<string>> {
    const { data, error } = await this.client
      .from('media')
      .select('id')
      .eq('owner_id', ownerId);
    if (error != null) throw new Error(error.message);
    return new Set(data.map(row => row.id));
  }

  async setPostingDeleted(ownerId: string, postingId: string, deletedAt: Date | null): Promise<void> {
    const { error } = await this.client
      .from('media')
      .update({ deleted_at: deletedAt?.toISOString() ?? null })
      // Owner-scoped: a posting id alone must not be enough to touch a row.
      .eq('owner_id', ownerId)
      .eq('posting_id', postingId);
    if (error != null) throw new Error(error.message);
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
