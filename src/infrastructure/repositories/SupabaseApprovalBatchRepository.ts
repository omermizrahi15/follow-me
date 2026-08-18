import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppSupabaseClient } from '../supabase/types';
import type { CachedPhoto } from '../cache/SuggestionCache';

/**
 * Reads a computed approval batch that the auto-post job persisted (issue #71).
 * The rich push carries only a `batchId`; the app fetches the full batch + pool
 * here so the push payload stays under the APNs 4KB limit. The stored jsonb
 * arrays already match `CachedPhoto`, so they drop straight into SuggestionCache.
 */
type ApprovalBatchRow = {
  batch_id: string;
  publisher_id: string;
  batch: CachedPhoto[];
  pool: CachedPhoto[];
  created_at: string;
  posted_at: string | null;
  posting_id: string | null;
};

interface Database {
  public: {
    Tables: {
      approval_batches: {
        Row: ApprovalBatchRow;
        Insert: Omit<ApprovalBatchRow, 'created_at' | 'posted_at' | 'posting_id'> & {
          created_at?: string;
          posted_at?: string | null;
          posting_id?: string | null;
        };
        Update: Partial<ApprovalBatchRow>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

export interface ApprovalBatch {
  batch: CachedPhoto[];
  pool: CachedPhoto[];
}

export class SupabaseApprovalBatchRepository {
  private readonly client: SupabaseClient<Database>;

  // Takes the shared authenticated client (issue #115): its session is what puts
  // `auth.uid()` behind every query, which is what the RLS policies match on.
  constructor(client: AppSupabaseClient) {
    this.client = client as unknown as SupabaseClient<Database>;
  }

  /** The batch/pool for `batchId`, or null if the row is missing (expired/pruned). */
  async fetch(batchId: string): Promise<ApprovalBatch | null> {
    const { data, error } = await this.client
      .from('approval_batches')
      .select('batch, pool')
      .eq('batch_id', batchId)
      .maybeSingle();
    if (error != null) throw new Error(error.message);
    if (data == null) return null;
    // batch is NOT NULL and pool defaults to '[]' server-side, so both arrive as arrays.
    return { batch: data.batch, pool: data.pool };
  }

  /**
   * Persist a batch the app computed, so the server can publish it by id.
   *
   * Production batches are written by the auto-post job; this exists for the
   * dev test notification, whose "Post now" would otherwise have no server-side
   * batch to send and could only ask for the app — leaving the background-post
   * path untestable without waiting for the cron.
   */
  async save(
    batchId: string,
    publisherId: string,
    batch: CachedPhoto[],
    /**
     * Swap alternatives. Was hardcoded to `[]`, which meant a batch opened from
     * a test push had no swap material at all — the review screen could only
     * show those exact photos and then say "no more photos". Since the test
     * push is how this flow gets exercised, the bug looked like a product
     * failure every time anyone checked it.
     */
    pool: CachedPhoto[] = [],
  ): Promise<void> {
    const { error } = await this.client
      .from('approval_batches')
      .insert({ batch_id: batchId, publisher_id: publisherId, batch, pool });
    if (error != null) throw new Error(error.message);
  }
}
