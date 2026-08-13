import { useCallback } from 'react';
import { listSubscribers, removeSubscriber } from '../../composition/container';
import type { SubscriberDto } from '../../application/dtos';
import { invalidateSubscribers, subscribersKey } from '../data/queries';
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
  const { data, loading, error, reload, read, update } = useCachedQuery(
    publisherId != null ? subscribersKey(publisherId) : null,
    async () => {
      // Unreachable while signed out: a null key means the query never runs.
      if (publisherId == null) return [];
      return listSubscribers.list(publisherId);
    },
    { revalidateOnFocus: true },
  );

  const remove = useCallback(
    async (subscriberId: string): Promise<void> => {
      if (publisherId == null) return;
      // Optimistically drop the row; put it back if the write fails. Callers
      // surface the failure themselves (the Followers section alerts) — this
      // only has to make sure the list never claims a removal that didn't
      // happen, and that the server has the last word once it can be reached.
      //
      // `read()` rather than the rendered `subscribers`: closing over that made
      // a new callback on every change, which re-ran every effect depending on
      // it. This callback now keeps one identity for the life of the hook.
      const previous = read() ?? [];
      update(previous.filter(s => s.id !== subscriberId));
      try {
        await removeSubscriber.remove({ publisherId, subscriberId });
      } catch (e: unknown) {
        update(previous);
        invalidateSubscribers(publisherId);
        throw e;
      }
    },
    [publisherId, read, update],
  );

  return { subscribers: data ?? [], loading, error, reload, remove };
}
