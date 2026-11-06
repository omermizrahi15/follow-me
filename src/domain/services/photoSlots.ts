/**
 * Takes one photo out of a post's slots, keeping the order of the rest.
 *
 * The last photo is never removed: a post with no photos has nothing to
 * publish, and "skip this post" is the way to leave one out entirely.
 */
export function removeSlot(slots: string[], photoId: string): string[] {
  if (slots.length <= 1 || !slots.includes(photoId)) return slots;
  return slots.filter(id => id !== photoId);
}
