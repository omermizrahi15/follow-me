import { listFeed } from '../../composition/container';
import { mergeFeedPages } from '../../application/services/mergeFeedPages';
import type { FeedPostingDto } from '../../application/dtos';
import { toFeedPosting, type FeedPosting } from '../data/feed';
import { feedKey } from '../data/queries';
import { useCachedQuery } from './useCachedQuery';

interface UseFeed {
  postings: FeedPosting[];
  loading: boolean;
  /** The caught failure itself — see `useCachedQuery`. */
  error: unknown;
  /**
   * Whether `postings` is the publisher's whole history. Anything that reasons
   * about what is *missing* from the feed — the history-gap detector — has to
   * wait for this, or it will read a feed that has not arrived yet as a stretch
   * of the trip with nothing posted in it.
   */
  complete: boolean;
  reload: () => Promise<void>;
}

/**
 * The publisher's real feed — uploaded media grouped into postings, newest first.
 *
 * Served from the shared cache (issue #114), so the Me page and the map render
 * the same array from one request, and coming back to Home shows it instantly
 * while any refresh happens behind. Writes that change the feed invalidate it
 * (see `ui/data/queries`), so nothing has to ask for a reload by hand.
 *
 * Still refreshes on focus: a post can appear without this app fetching
 * anything — the approval notification's "Post now" publishes server-side while
 * the app is backgrounded.
 */
export function useFeed(publisherId: string | null): UseFeed {
  const { data, loading, error, reload } = useCachedQuery(
    publisherId != null ? feedKey(publisherId) : null,
    async () => {
      // Unreachable while signed out: a null key means the query never runs.
      if (publisherId == null) return [];
      // A page at a time (issue #116). The feed only grows, and one query for
      // all of it got slower and heavier with every trip taken; each request
      // here is bounded whatever the length of the history behind it.
      //
      // Pages are windows over media rows, so a posting can straddle a
      // boundary and arrive split — mergeFeedPages joins it back.
      let postings: FeedPostingDto[] = [];
      let offset: number | null = 0;
      while (offset != null) {
        const page = await listFeed.list(publisherId, { offset });
        postings = mergeFeedPages(postings, page.postings);
        offset = page.nextOffset;
      }
      return postings.map(toFeedPosting);
    },
    { revalidateOnFocus: true },
  );

  // Every page is in before the query resolves, so anything the cache holds is
  // a whole feed — stale, at worst, never partial.
  return { postings: data ?? [], loading, error, complete: data != null, reload };
}
