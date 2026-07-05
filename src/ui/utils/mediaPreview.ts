import type { FeedMedia } from '../components/PhotoFeed';
import { videoPosterUri } from '../../infrastructure/storage/cloudinaryDelivery';

export { displaySizedUri } from '../../infrastructure/storage/cloudinaryDelivery';

/**
 * A URI that an <Image> can render for any feed media: images pass through,
 * videos resolve to their Cloudinary poster frame.
 */
export function mediaPreviewUri(media: FeedMedia): string | undefined {
  if (media.uri == null || media.type !== 'video') return media.uri;
  return videoPosterUri(media.uri);
}
