import { useState } from 'react';
import { sharePhoto } from '../../composition/container';
import type { PhotoDto } from '../../application/dtos';

interface SharePhotoState {
  loading: boolean;
  error: string | null;
  result: PhotoDto | null;
}

export function useSharePhoto(): SharePhotoState & { share: (localUri: string, filename: string, ownerId: string) => Promise<void> } {
  const [state, setState] = useState<SharePhotoState>({
    loading: false,
    error: null,
    result: null,
  });

  async function share(localUri: string, filename: string, ownerId: string): Promise<void> {
    setState({ loading: true, error: null, result: null });
    try {
      const dto = await sharePhoto.execute({
        photoId: Date.now().toString(),
        ownerId,
        localUri,
        filename,
      });
      setState({ loading: false, error: null, result: dto });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Something went wrong';
      setState({ loading: false, error: message, result: null });
    }
  }

  return { ...state, share };
}
