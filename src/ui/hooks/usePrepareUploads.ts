import { useEffect } from 'react';
import { prepareUploads } from '../../composition/container';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';

/**
 * Starts getting the chosen photos ready to send the moment they are chosen, so
 * pressing Send only has to upload. Optimistic and silent: if it fails or is
 * cut short, the upload prepares the photo itself exactly as it always did.
 *
 * Re-runs only when the set of photos changes (keyed on ids), and preparing an
 * already-prepared photo is a no-op, so swapping one photo costs one photo.
 */
export function usePrepareUploads(photos: readonly PhotoCandidate[]): void {
  const key = photos.map(p => p.id).join('|');
  useEffect(() => {
    if (photos.length === 0) return;
    void prepareUploads.execute(photos).catch(() => undefined);
    // `key` stands in for `photos`: a new array of the same photos is not new work.
  }, [key]);
}
