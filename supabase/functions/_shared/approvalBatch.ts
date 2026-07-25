// Persists a computed "batch ready to review" so the app can fetch it by id
// (issue #71). APNs caps a push at 4KB and a full batch (default 10) + pool
// (≤20) blew past that, so the rich push now carries only batch_id + a compact
// gallery; the app reads the full detail from `approval_batches`.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export interface ApprovalBatchPhoto {
  id: string;
  url: string;
  category: string;
  caption: string;
  quality: number;
  scene: string;
  place: string;
  createdAt: number;
}

/** Cap on gallery URLs embedded in the push — matches the content extension's grid cap. */
export const PUSH_GALLERY_LIMIT = 9;

/**
 * Persist the batch + pool keyed by batchId. Throws on failure: unlike the
 * gallery link, this row is load-bearing — the app fetches the batch from it,
 * so a silent failure would leave the review screen with nothing to show.
 */
export async function saveApprovalBatch(
  supabase: SupabaseClient,
  batchId: string,
  publisherId: string,
  batch: ApprovalBatchPhoto[],
  pool: ApprovalBatchPhoto[],
): Promise<void> {
  const { error } = await supabase
    .from('approval_batches')
    .insert({ batch_id: batchId, publisher_id: publisherId, batch, pool });
  if (error != null) throw new Error(`saveApprovalBatch: ${error.message}`);
}

/** The compact list of photo URLs the content extension renders in the expanded push. */
export function galleryUrls(batch: ApprovalBatchPhoto[], limit = PUSH_GALLERY_LIMIT): string[] {
  return batch.slice(0, limit).map(p => p.url);
}
