import { listFeed } from '../../composition/container';
import { toFeedPosting, type FeedPosting } from '../data/feed';
import { feedKey } from '../data/queries';
import { useCachedQuery } from './useCachedQuery';

interface UseFeed {
  postings: FeedPosting[];
  loading: boolean;
  error: string | null;
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
      return (await listFeed.list(publisherId)).map(toFeedPosting);
    },
    { revalidateOnFocus: true },
  );

  return { postings: data ?? [], loading, error, reload };
}
