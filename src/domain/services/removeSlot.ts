/**
 * Take one photo out of a post without replacing it. Refuses to empty the
 * post: with nothing left there is nothing to send, and the publisher wanting
 * a different photo should use "Other" instead.
 */
export function removeSlot(slots: string[], id: string): string[] {
  if (slots.length <= 1 || !slots.includes(id)) return slots;
  return slots.filter(s => s !== id);
}
