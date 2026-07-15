// Shared publisher-name resolution, previously duplicated across the subscribe,
// join-webhook, send-post and auto-post services. No supabase-js import — the
// client slice is structural (like _shared/messageLog.ts), which keeps this file
// free of the extensioned Deno/@types/node graph.

/**
 * Display name from auth metadata with fallbacks: metadata display_name →
 * email local-part → a generic label. `||` (not `??`) so an empty display_name
 * falls through. Used by the subscribe + join-webhook confirmations.
 */
export function publisherDisplayName(
  metadata: Record<string, string> | null | undefined,
  email: string | null | undefined,
): string {
  return metadata?.display_name || email?.split('@')[0] || 'your publisher';
}

/**
 * Post identity for a publisher: the app-chosen profile display name (falling
 * back to auth full_name, then "Your friend") plus their phone. Used by the
 * send-post + auto-post senders.
 *
 * The client is typed `any`: unlike messageLog's simple insert/update DbClient,
 * this reads through the supabase-js `.select().eq().maybeSingle()` chain and
 * `auth.admin`, whose deep generics trip TS2589 ("excessively deep") when matched
 * structurally.
 */
export async function publisherIdentity(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  publisherId: string,
): Promise<{ name: string; phone?: string }> {
  // The profile's display name is what the publisher chose in the app; auth
  // metadata is only a fallback (often empty for email signups).
  let profileName = '';
  try {
    const { data } = await supabase
      .from('publisher_profile')
      .select('display_name')
      .eq('publisher_id', publisherId)
      .maybeSingle();
    profileName = data?.display_name ?? '';
  } catch { /* fall through to auth metadata */ }
  try {
    const { data } = await supabase.auth.admin.getUserById(publisherId);
    const meta = (data.user?.user_metadata ?? {}) as { full_name?: string };
    return { name: profileName || meta.full_name || 'Your friend', phone: data.user?.phone };
  } catch {
    return { name: profileName || 'Your friend' };
  }
}
