import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { listFeed } from '../../composition/container';
import type { FeedPosting } from '../components/PhotoFeed';
import type { FeedPostingDto } from '../../application/dtos';

interface FeedState {
  postings: FeedPosting[];
  loading: boolean;
  error: string | null;
}

interface UseFeed extends FeedState {
  reload: () => Promise<void>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function toFeedPosting(dto: FeedPostingDto): FeedPosting {
  return {
    id: dto.id,
    date: formatDate(dto.createdAt),
    media: dto.media.map(m => ({ id: m.id, uri: m.url })),
    ...(dto.location != null ? { place: dto.location } : {}),
  };
}

/** The publisher's real feed — uploaded media grouped into postings, newest first. */
export function useFeed(publisherId: string | null): UseFeed {
  const [state, setState] = useState<FeedState>({ postings: [], loading: true, error: null });

  const reload = useCallback(async (): Promise<void> => {
    if (publisherId == null) {
      // Callers should mount the feed only after auth resolves; surface the
      // mistake in dev instead of silently rendering an empty feed.
      if (__DEV__) console.warn('useFeed: no publisherId — rendering an empty feed');
      setState({ postings: [], loading: false, error: null });
      return;
    }
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const dtos = await listFeed.list(publisherId);
      setState({ postings: dtos.map(toFeedPosting), loading: false, error: null });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Could not load your posts';
      setState({ postings: [], loading: false, error: message });
    }
  }, [publisherId]);

  // Refetch on every focus, not just mount — the Home screen stays mounted
  // under pushed screens (Upload, review), so returning from a post would
  // otherwise show a stale feed.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { ...state, reload };
}
