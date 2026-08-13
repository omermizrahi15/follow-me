import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { listFeed } from '../../composition/container';
import { mergeFeedPages } from '../../application/services/mergeFeedPages';
import type { FeedPostingDto } from '../../application/dtos';
import { toFeedPosting, type FeedPosting } from '../data/feed';

interface FeedState {
  dtos: FeedPostingDto[];
  loading: boolean;
  error: string | null;
  /**
   * Whether `postings` is the publisher's whole history yet. Anything that
   * reasons about what is *missing* from the feed — the history-gap detector —
   * has to wait for this, or it will read a page boundary as a gap in the trip.
   */
  complete: boolean;
}

interface UseFeed {
  postings: FeedPosting[];
  loading: boolean;
  error: string | null;
  complete: boolean;
  reload: () => Promise<void>;
}

const EMPTY: FeedState = { dtos: [], loading: true, error: null, complete: false };

/** The publisher's real feed — uploaded media grouped into postings, newest first. */
export function useFeed(publisherId: string | null): UseFeed {
  const [state, setState] = useState<FeedState>(EMPTY);
  // Bumped by every reload. A load that finds its number stale (the screen was
  // re-focused, or the publisher changed) drops its results rather than writing
  // an older feed over a newer one.
  const runId = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const run = ++runId.current;
    if (publisherId == null) {
      // Callers should mount the feed only after auth resolves; surface the
      // mistake in dev instead of silently rendering an empty feed.
      if (__DEV__) console.warn('useFeed: no publisherId — rendering an empty feed');
      setState({ dtos: [], loading: false, error: null, complete: true });
      return;
    }
    setState(prev => ({ ...prev, loading: true, error: null }));
    let dtos: FeedPostingDto[] = [];
    try {
      // The screen waits on the first page only; the rest arrive behind it.
      // Reading the whole feed in one query made opening Home cost more with
      // every trip taken, and a long history was a memory spike of its own
      // (issue #116).
      let offset: number | null = 0;
      while (offset != null) {
        const page = await listFeed.list(publisherId, { offset });
        if (runId.current !== run) return;
        dtos = mergeFeedPages(dtos, page.postings);
        offset = page.nextOffset;
        setState({ dtos, loading: false, error: null, complete: offset == null });
      }
    } catch (e: unknown) {
      if (runId.current !== run) return;
      const message = e instanceof Error ? e.message : 'Could not load your posts';
      // Pages already loaded stay on screen: dropping the feed because page
      // four failed would be a worse answer than showing the first three.
      setState({ dtos, loading: false, error: message, complete: false });
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

  const postings = useMemo(() => state.dtos.map(toFeedPosting), [state.dtos]);

  return { postings, loading: state.loading, error: state.error, complete: state.complete, reload };
}
