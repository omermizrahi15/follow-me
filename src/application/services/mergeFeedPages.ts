import type { FeedPostingDto } from '../dtos';

/**
 * Appends the next page of the feed to the postings already loaded.
 *
 * A page is a window over media rows, not over postings, so a posting with
 * more photos than the page had room for arrives split in two: the tail of one
 * page and the head of the next carry the same id. Concatenating blindly would
 * list that posting twice, each copy holding half of its photos.
 *
 * Only the boundary can repeat — pages are read in a total order — so one
 * comparison is enough, and the merge stays linear in the size of the page
 * rather than the length of the feed.
 */
export function mergeFeedPages(loaded: FeedPostingDto[], next: FeedPostingDto[]): FeedPostingDto[] {
  const [first, ...rest] = next;
  if (first == null) return loaded;
  const last = loaded[loaded.length - 1];
  if (last == null || last.id !== first.id) return [...loaded, ...next];
  // The earlier page holds the newer photos of the posting, so its media come
  // first — the same order a single unsplit page would have returned them in.
  return [...loaded.slice(0, -1), { ...last, media: [...last.media, ...first.media] }, ...rest];
}
