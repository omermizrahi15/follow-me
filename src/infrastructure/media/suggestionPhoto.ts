import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { ReadSuggestionPhoto } from '../music/EdgeFunctionSongSuggester';

/**
 * Long-edge bound for photos sent to suggest-song. The model only needs the
 * scene and mood — 512px keeps three photos around ~100KB total instead of
 * multi-MB originals.
 */
const SUGGESTION_PHOTO_WIDTH = 512;

/**
 * Downscales + re-encodes a local photo to a small base64 JPEG for the
 * suggest-song request. Null (never a throw) when the uri can't be processed —
 * the suggestion then just runs without that photo.
 */
export const expoReadSuggestionPhoto: ReadSuggestionPhoto = async uri => {
  try {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: SUGGESTION_PHOTO_WIDTH } }],
      { compress: 0.6, format: SaveFormat.JPEG, base64: true },
    );
    if (result.base64 == null || result.base64 === '') return null;
    return { base64: result.base64, mimeType: 'image/jpeg' };
  } catch {
    return null;
  }
};
