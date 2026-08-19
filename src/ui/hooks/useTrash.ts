import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { listFeed, trashPosting } from '../../composition/container';
import { toFeedPosting, type FeedPosting } from '../data/feed';
import { alertFailure, refuseIfOffline } from '../data/writeGuard';

interface TrashState {
  postings: FeedPosting[];
  loading: boolean;
  /** The caught failure itself — see the note in useFeed. */
  error: unknown;
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
      setState({ postings: [], loading: false, error: e });
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
      if (refuseIfOffline('Restoring a post')) return;
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
        setState(prev => ({ ...prev, postings: previous, error: e }));
        throw e;
      }
    },
    [publisherId, state.postings],
  );

  return { ...state, reload, restore };
}

/**
 * Deletes straight away, no dialog — for the feed's swipe-to-delete, where the
 * swipe plus a deliberate tap on a red Delete button already is the
 * confirmation, exactly as an iOS list row behaves. Safe to do without asking
 * because it is a soft delete: Settings → Deleted posts brings it back.
 */
export function moveToTrash(
  publisherId: string | null,
  posting: FeedPosting,
  onTrashed: () => void,
): void {
  if (publisherId == null) return;
  // Deleting is not queued while offline. A delete that replayed later would
  // remove a post the publisher had since decided to keep, with no prompt and
  // no trace of why (issue #145).
  if (refuseIfOffline('Deleting a post')) return;
  void trashPosting
    .trash({ publisherId, postingId: posting.id })
    .then(onTrashed)
    .catch((e: unknown) => alertFailure(e, 'Couldn’t delete this post'));
}

/**
 * Asks before moving a post to the trash, then does it — for the story viewer,
 * where deleting is a single tap and so needs a gate the swipe already
 * provides. The copy explains what the swipe can't: the post leaves the feed
 * and the map but is recoverable, and followers already have the photos.
 */
export function confirmMoveToTrash(
  publisherId: string | null,
  posting: FeedPosting,
  onTrashed: () => void,
): void {
  if (publisherId == null) return;
  if (refuseIfOffline('Deleting a post')) return;
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
            .catch((e: unknown) => alertFailure(e, 'Couldn’t delete this post'));
        },
      },
    ],
  );
}
