import { useState } from 'react';
import { shareMedia } from '../../composition/container';
import type { MediaDto } from '../../application/dtos';

interface ShareMediaState {
  loading: boolean;
  error: string | null;
  result: MediaDto | null;
}

export function useShareMedia(): ShareMediaState & { share: (localUri: string, filename: string, ownerId: string) => Promise<void> } {
  const [state, setState] = useState<ShareMediaState>({
    loading: false,
    error: null,
    result: null,
  });

  async function share(localUri: string, filename: string, ownerId: string): Promise<void> {
    setState({ loading: true, error: null, result: null });
    try {
      const dto = await shareMedia.share({
        mediaId: Date.now().toString(),
        ownerId,
        localUri,
        filename,
      });
      setState({ loading: false, error: null, result: dto });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Something went wrong';
      setState({ loading: false, error: message, result: null });
      throw e;
    }
  }

  return { ...state, share };
}
