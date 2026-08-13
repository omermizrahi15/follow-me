import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppSupabaseClient } from '../supabase/types';
import type { IPostGalleryRepository } from '../../domain/interfaces';

interface Database {
  public: {
    Tables: {
      posts: {
        Row: {
          id: string;
          publisher_id: string;
          media_urls: string[];
          place: string | null;
          posting_id: string | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: never;
        Update: { deleted_at?: string | null };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

/**
 * The followers' copy of a posting: the `posts` row the web gallery reads.
 *
 * Rows are written server-side by the send functions (savePostGallery) and this
 * repository only flips `deleted_at`, which is why `Insert` above is `never` —
 * the app has no insert path, and the RLS policy (20240032) grants it update
 * only.
 */
export class SupabasePostGalleryRepository implements IPostGalleryRepository {
  private readonly client: SupabaseClient<Database>;

  // Takes the shared authenticated client (issue #115): its session is what puts
  // `auth.uid()` behind every query, which is what the RLS policies match on.
  constructor(client: AppSupabaseClient) {
    this.client = client as unknown as SupabaseClient<Database>;
  }

  async setPostingDeleted(publisherId: string, postingId: string, deletedAt: Date | null): Promise<void> {
    const { error } = await this.client
      .from('posts')
      .update({ deleted_at: deletedAt?.toISOString() ?? null })
      // Owner-scoped in the query as well as in RLS: the policy is the boundary,
      // this keeps the write honest against a misconfigured environment.
      .eq('publisher_id', publisherId)
      .eq('posting_id', postingId);
    if (error != null) throw new Error(error.message);
  }
}
