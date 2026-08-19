/**
 * The words a follower actually reads when a posting goes out.
 *
 * DUAL RUNTIME — the app composes the body for device-initiated sends, and the
 * Deno `send-post` / `auto-post` Edge Functions import this same module for
 * server-initiated ones. It stays import-free and platform-free; see
 * CONTRIBUTING.md.
 *
 * The two paths are deliberately NOT the same sentence. A device-initiated
 * share names the places the publisher's own media carried; an autonomous post
 * has no media rows yet, so it leads with the photo count and carries a gallery
 * link. Both live here so the copy is reviewed in one place.
 */

/** Anything carrying an optional place label — the `Media` entity satisfies it. */
export interface LocatedItem {
  readonly location?: string | undefined;
}

/**
 * The "reply to the publisher" link a follower taps (issue #143).
 *
 * WhatsApp has NO deep link that opens a quoted reply to a specific message —
 * no URL scheme, no Business API parameter. `wa.me` can open a chat and
 * pre-fill the composer, and that is the whole toolbox. So the next best thing
 * is pre-filling the subject: the publisher gets "Re: your photos from Rome ✨"
 * instead of a bare "hey" with no idea which post it answers.
 *
 * The follower is the sender here, so the copy addresses the publisher in the
 * second person. `place` is optional — an autonomous post with no GPS fix, or a
 * share whose media carried no location, falls back to "your latest photos".
 *
 * MIRRORED in `supabase/functions/_shared/postTemplate.ts`, which must stay
 * import-free to remain jest-importable; `postTemplate.test.ts` asserts the two
 * produce byte-identical links.
 */
export function composeReplyLink(publisherPhone: string, place?: string | null): string {
  const waPhone = publisherPhone.replace(/^\+/, '');
  const label = (place ?? '').replace(/\s+/g, ' ').trim();
  const subject = label !== '' ? `your photos from ${label}` : 'your latest photos';
  return `https://wa.me/${waPhone}?text=${encodeURIComponent(`Re: ${subject} ✨`)}`;
}

export function composeNotificationBody(
  publisherName: string,
  media: readonly LocatedItem[],
  publisherPhone?: string,
): string {
  const locationClause = formatLocationClause(selectTopLocations(media));
  const locationPart = locationClause != null ? ` from ${locationClause}` : '';
  const headline = `Checkout ${publisherName} latest photos${locationPart} 📸`;
  if (publisherPhone == null) return headline;
  // The same places the headline names become the pre-filled subject, so the
  // publisher reads "Re: your photos from Rome ✨" when the reply arrives.
  return `${headline}\nChat with ${publisherName}: ${composeReplyLink(publisherPhone, locationClause)}`;
}

export function selectTopLocations(media: readonly LocatedItem[]): string[] {
  const counts = new Map<string, number>();
  for (const m of media) {
    if (m.location != null) {
      counts.set(m.location, (counts.get(m.location) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([location]) => location);
}

export function formatLocationClause(locations: string[]): string | null {
  const [first, second, ...rest] = locations;
  if (first == null) return null;
  if (second == null) return first;
  if (rest.length === 0) return `${first} & ${second}`;
  return `${first}, ${second} and more`;
}

/** A "see all the photos" link, when the posting has a hosted gallery. */
export interface GalleryLink {
  url: string;
  photoCount: number;
}

/**
 * The autonomous path's body. There are no `Media` rows to read places from at
 * this point, so the place arrives already resolved (reverse-geocoded from the
 * batch's GPS server-side — issue #23) and may be null.
 */
export function composeAutoPostBody(
  publisherName: string,
  publisherPhone?: string,
  gallery?: GalleryLink | null,
  place?: string | null,
): string {
  const headline = place != null && place.trim() !== ''
    ? `Check out ${publisherName}'s latest photos from ${place.trim()} 📸`
    : `Check out ${publisherName}'s latest photos 📸`;
  const lines = [headline];
  if (gallery != null) {
    lines.push(`See all ${gallery.photoCount} photos: ${gallery.url}`);
  }
  if (publisherPhone != null && publisherPhone !== '') {
    lines.push(`Hit the link to reply to ${publisherName}: ${composeReplyLink(publisherPhone, place)}`);
  }
  // Blank line between sections — easier to scan as a WhatsApp message.
  return lines.join('\n\n');
}
