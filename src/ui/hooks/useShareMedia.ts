import { useState } from 'react';
import { shareMedia } from '../../composition/container';
import type { MediaDto } from '../../application/dtos';
import type { MediaType } from '../../domain/entities/Media';
import type { Coordinate } from '../../domain/interfaces';

interface MediaItem {
  mediaId: string;
  localUri: string;
  filename: string;
  mediaType?: MediaType;
  coordinate?: Coordinate;
}

interface ShareMediaState {
  loading: boolean;
  error: string | null;
  result: MediaDto[] | null;
}

export function useShareMedia(): ShareMediaState & { share: (items: MediaItem[], ownerId: string) => Promise<void> } {
  const [state, setState] = useState<ShareMediaState>({
    loading: false,
    error: null,
    result: null,
  });

  async function share(items: MediaItem[], ownerId: string): Promise<void> {
    setState({ loading: true, error: null, result: null });
    try {
      const dtos = await shareMedia.share({ ownerId, items });
      setState({ loading: false, error: null, result: dtos });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Something went wrong';
      setState({ loading: false, error: message, result: null });
      throw e;
    }
  }

  return { ...state, share };
}
