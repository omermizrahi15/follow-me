import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { listFeed, trashPosting } from '../../composition/container';
import { toFeedPosting, type FeedPosting } from '../data/feed';

interface TrashState {
  postings: FeedPosting[];
  loading: boolean;
  error: string | null;
}

interface UseTrashedPostings extends TrashState {
  reload: () => Promise<void>;
  restore: (postingId: string) => Promise<void>;
}

/** The publisher's deleted posts, most recently deleted first. */
export function useTrashedPostings(publisherId: string | null): UseTrashedPostings {
  const [state, setState] = useState<TrashState>({ postings: [], loading: true, error: null });

  const reload = useCallback(async (): Promise<void> => {
    if (publisherId == null) {
      setState({ postings: [], loading: false, error: null });
      return;
    }
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const dtos = await listFeed.listDeleted(publisherId);
      setState({ postings: dtos.map(toFeedPosting), loading: false, error: null });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Could not load deleted posts';
      setState({ postings: [], loading: false, error: message });
    }
  }, [publisherId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const restore = useCallback(
    async (postingId: string): Promise<void> => {
      if (publisherId == null) return;
      // Optimistically drop the row from the trash; put it back if the write
      // fails, so the list never claims a restore that didn't happen.
      const previous = state.postings;
      setState(prev => ({
        ...prev,
        postings: prev.postings.filter(p => p.id !== postingId),
        error: null,
      }));
      try {
        await trashPosting.restore({ publisherId, postingId });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Could not restore this post';
        setState(prev => ({ ...prev, postings: previous, error: message }));
        throw e;
      }
    },
    [publisherId, state.postings],
  );

  return { ...state, reload, restore };
}

/**
 * Asks before moving a post to the trash, then does it. Shared by the feed card
 * and the story viewer so both explain the same thing: the post leaves the feed
 * and the map but is recoverable, and followers already have the photos.
 */
export function confirmMoveToTrash(
  publisherId: string | null,
  posting: FeedPosting,
  onTrashed: () => void,
): void {
  if (publisherId == null) return;
  Alert.alert(
    'Delete post',
    `${posting.place ?? posting.date} will be removed from your feed and the map. You can restore it from Settings → Deleted posts. Followers who already received it keep their copy.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void trashPosting
            .trash({ publisherId, postingId: posting.id })
            .then(onTrashed)
            .catch(() => Alert.alert('Could not delete this post', 'Please try again.'));
        },
      },
    ],
  );
}
