// Shared publisher-name resolution, previously duplicated across the subscribe,
// join-webhook, send-post and auto-post services. No supabase-js import — the
// client slice is structural (like _shared/messageLog.ts), which keeps this file
// free of the extensioned Deno/@types/node graph.

/**
 * The app-chosen display name from `publisher_profile`, or '' when there is no
 * row (or the read fails). This is the name the publisher typed in the app, so
 * it outranks anything auth happens to hold.
 *
 * The client is typed `any`: unlike messageLog's simple insert/update DbClient,
 * this reads through the supabase-js `.select().eq().maybeSingle()` chain, whose
 * deep generics trip TS2589 ("excessively deep") when matched structurally.
 */
async function profileDisplayName(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  publisherId: string,
): Promise<string> {
  try {
    const { data } = await supabase
      .from('publisher_profile')
      .select('display_name')
      .eq('publisher_id', publisherId)
      .maybeSingle();
    return data?.display_name ?? '';
  } catch {
    return '';
  }
}

/**
 * Display name for the follower-facing confirmations, in preference order:
 * profile display_name → auth metadata display_name/full_name → email
 * local-part → a generic label. `||` (not `??`) so an empty name at any step
 * falls through.
 */
export function publisherDisplayName(
  profileName: string | null | undefined,
  metadata: Record<string, string> | null | undefined,
  email: string | null | undefined,
): string {
  return profileName || metadata?.display_name || metadata?.full_name ||
    email?.split('@')[0] || 'your publisher';
}

/**
 * Name to greet a new follower with. Returns null when the publisher does not
 * exist, so join-webhook can tell "unknown link" from "unnamed publisher".
 *
 * Reads the profile first: publishers sign in by phone, so auth usually holds
 * neither an email nor a display_name, and name resolution that only looked at
 * auth greeted every follower with the generic label.
 */
export async function resolvePublisherName(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  publisherId: string,
): Promise<string | null> {
  const profileName = await profileDisplayName(supabase, publisherId);
  try {
    const { data } = await supabase.auth.admin.getUserById(publisherId);
    if (!data.user) return null;
    return publisherDisplayName(profileName, data.user.user_metadata as Record<string, string>, data.user.email);
  } catch {
    // A malformed id or a transient auth error: the profile name, if we have
    // one, is still the right answer.
    return profileName || null;
  }
}

/**
 * Post identity for a publisher: the app-chosen profile display name (falling
 * back to auth full_name, then "Your friend") plus their phone. Used by the
 * send-post + auto-post senders.
 */
export async function publisherIdentity(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  publisherId: string,
): Promise<{ name: string; phone?: string }> {
  const profileName = await profileDisplayName(supabase, publisherId);
  try {
    const { data } = await supabase.auth.admin.getUserById(publisherId);
    const meta = (data.user?.user_metadata ?? {}) as { full_name?: string };
    return { name: profileName || meta.full_name || 'Your friend', phone: data.user?.phone };
  } catch {
    return { name: profileName || 'Your friend' };
  }
}
