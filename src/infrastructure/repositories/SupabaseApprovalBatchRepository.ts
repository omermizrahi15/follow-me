import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database';
import type { CachedPhoto } from '../cache/SuggestionCache';

export interface ApprovalBatch {
  batch: CachedPhoto[];
  pool: CachedPhoto[];
}

export class SupabaseApprovalBatchRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

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
  async save(batchId: string, publisherId: string, batch: CachedPhoto[]): Promise<void> {
    const { error } = await this.client
      .from('approval_batches')
      .insert({ batch_id: batchId, publisher_id: publisherId, batch, pool: [] });
    if (error != null) throw new Error(error.message);
  }
}
