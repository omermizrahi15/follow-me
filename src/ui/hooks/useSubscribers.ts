import { useCallback, useRef } from 'react';
import { listSubscribers, removeSubscriber } from '../../composition/container';
import type { SubscriberDto } from '../../application/dtos';
import { subscribersKey } from '../data/queries';
import { useCachedQuery } from './useCachedQuery';

interface UseSubscribers {
  subscribers: SubscriberDto[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  remove: (subscriberId: string) => Promise<void>;
}

/**
 * The publisher's followers, from the shared cache (issue #114) — Home's count,
 * the Followers section and the Upload screen's recipient list are one request
 * between them, and a removal shows in all three at once.
 *
 * Refreshes on focus, because followers arrive without this app doing anything:
 * someone opens the invite link and subscribes.
 */
export function useSubscribers(publisherId: string | null): UseSubscribers {
  const { data, loading, error, reload, update } = useCachedQuery(
    publisherId != null ? subscribersKey(publisherId) : null,
    async () => {
      // Unreachable while signed out: a null key means the query never runs.
      if (publisherId == null) return [];
      return listSubscribers.list(publisherId);
    },
    { revalidateOnFocus: true },
  );
  const subscribers = data ?? [];

  // The list is read through a ref rather than closed over, so `remove` keeps
  // one identity for the life of the hook. Closing over it meant a new callback
  // on every state change, which re-ran every effect depending on it — the
  // exact loop that made a removal cost more than the request it performed.
  const latest = useRef(subscribers);
  latest.current = subscribers;

  const remove = useCallback(
    async (subscriberId: string): Promise<void> => {
      if (publisherId == null) return;
      // Optimistically drop the row; restore on failure. Callers surface the
      // failure themselves (the Followers section alerts) — this only has to
      // make sure the list never claims a removal that didn't happen.
      const previous = latest.current;
      update(previous.filter(s => s.id !== subscriberId));
      try {
        await removeSubscriber.remove({ publisherId, subscriberId });
      } catch (e: unknown) {
        update(previous);
        throw e;
      }
    },
    [publisherId, update],
  );

  return { subscribers, loading, error, reload, remove };
}
