import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  usableUploads,
  withUploads,
  type UploadCheckpoint,
} from '../../domain/services/uploadCheckpoint';

/**
 * Where a half-finished post's uploads are remembered between attempts
 * (issue #145).
 *
 * On disk rather than in memory, because the interesting failure is not a
 * caught exception — it is the publisher giving up on a dead connection,
 * closing the app, and finishing the post from the hotel lobby an hour later.
 *
 * Every function here is best-effort. This is an optimisation: losing the note
 * costs an upload, while throwing from it would cost the post.
 */

const key = (publisherId: string): string => `share-uploads-v1:${publisherId}`;

async function read(publisherId: string): Promise<UploadCheckpoint | null> {
  try {
    const raw = await AsyncStorage.getItem(key(publisherId));
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as UploadCheckpoint;
    // A hand-edited or half-written value is indistinguishable from no value.
    if (typeof parsed.at !== 'number' || typeof parsed.urls !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Urls from an earlier attempt that are still worth reusing. */
export async function resumableUploads(publisherId: string): Promise<Record<string, string>> {
  return usableUploads(await read(publisherId), Date.now());
}

/** Note what this attempt got into the cloud. */
export async function rememberUploads(
  publisherId: string,
  uploads: readonly { mediaId: string; url: string }[],
): Promise<void> {
  try {
    const next = withUploads(await read(publisherId), uploads, Date.now());
    await AsyncStorage.setItem(key(publisherId), JSON.stringify(next));
  } catch {
    // The retry will just re-upload. Nothing else depends on this.
  }
}

/**
 * The post went out — forget the notes. Left behind, they would be offered to
 * the *next* post, whose items have different ids and so would never match;
 * dead weight, but weight that expires either way.
 */
export async function clearUploads(publisherId: string): Promise<void> {
  await AsyncStorage.removeItem(key(publisherId)).catch(() => undefined);
}
