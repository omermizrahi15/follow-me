import { useCallback, useEffect, useState } from 'react';
import { listSubscribers, removeSubscriber } from '../../composition/container';
import type { SubscriberDto } from '../../application/dtos';

interface SubscribersState {
  subscribers: SubscriberDto[];
  loading: boolean;
  /** The caught failure itself — see the note in useFeed. */
  error: unknown;
}

interface UseSubscribers extends SubscribersState {
  reload: () => Promise<void>;
  remove: (subscriberId: string) => Promise<void>;
}

export function useSubscribers(publisherId: string | null): UseSubscribers {
  const [state, setState] = useState<SubscribersState>({
    subscribers: [],
    loading: true,
    error: null,
  });

  const reload = useCallback(async (): Promise<void> => {
    if (publisherId == null) {
      setState({ subscribers: [], loading: false, error: null });
      return;
    }
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const subscribers = await listSubscribers.list(publisherId);
      setState({ subscribers, loading: false, error: null });
    } catch (e: unknown) {
      setState({ subscribers: [], loading: false, error: e });
    }
  }, [publisherId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = useCallback(
    async (subscriberId: string): Promise<void> => {
      if (publisherId == null) return;
      // Optimistically drop the row; restore on failure.
      const previous = state.subscribers;
      setState(prev => ({
        ...prev,
        subscribers: prev.subscribers.filter(s => s.id !== subscriberId),
        error: null,
      }));
      try {
        await removeSubscriber.remove({ publisherId, subscriberId });
      } catch (e: unknown) {
        setState(prev => ({ ...prev, subscribers: previous, error: e }));
        throw e;
      }
    },
    [publisherId, state.subscribers],
  );

  return { ...state, reload, remove };
}
