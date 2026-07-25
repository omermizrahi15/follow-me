import { createClient } from '@supabase/supabase-js';
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
};

interface Database {
  public: {
    Tables: {
      approval_batches: {
        Row: ApprovalBatchRow;
        Insert: Omit<ApprovalBatchRow, 'created_at'> & { created_at?: string };
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
  private client: ReturnType<typeof createClient<Database>>;

  constructor(url: string, anonKey: string) {
    this.client = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
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
}
