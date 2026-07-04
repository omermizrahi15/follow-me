import type { FeedMedia } from '../components/PhotoFeed';

/**
 * A URI that an <Image> can render for any feed media. Videos can't be shown
 * by <Image>, but Cloudinary serves a poster frame for a video URL when the
 * file extension is swapped to .jpg — so a video still gets a real preview.
 */
export function mediaPreviewUri(media: FeedMedia): string | undefined {
  if (media.uri == null || media.type !== 'video') return media.uri;
  return media.uri.replace(/\.\w+$/, '.jpg');
}
