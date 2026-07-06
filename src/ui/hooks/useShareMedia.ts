import { useState } from 'react';
import { shareMedia } from '../../composition/container';
import type { MediaDto } from '../../application/dtos';
import type { ShareProgress } from '../../application/usecases/ShareMediaUseCase';
import type { MediaType } from '../../domain/entities/Media';

interface MediaItem {
  mediaId: string;
  localUri: string;
  filename: string;
  mediaType?: MediaType;
}

interface ShareMediaState {
  loading: boolean;
  error: string | null;
  result: MediaDto[] | null;
  /** Live stage/count while a share is in flight (null when idle). */
  progress: ShareProgress | null;
}

export function useShareMedia(): ShareMediaState & { share: (items: MediaItem[], ownerId: string) => Promise<void> } {
  const [state, setState] = useState<ShareMediaState>({
    loading: false,
    error: null,
    result: null,
    progress: null,
  });

  async function share(items: MediaItem[], ownerId: string): Promise<void> {
    setState({ loading: true, error: null, result: null, progress: null });
    try {
      const dtos = await shareMedia.share({ ownerId, items }, progress => {
        setState(s => ({ ...s, progress }));
      });
      setState({ loading: false, error: null, result: dtos, progress: null });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Something went wrong';
      setState({ loading: false, error: message, result: null, progress: null });
      throw e;
    }
  }

  return { ...state, share };
}
