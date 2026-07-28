import { Image } from 'react-native';

/**
 * Pixel width of an image, without decoding it into JS. Used to skip the
 * resize step for photos that are already small enough — resizing *up* would
 * only add bytes.
 */
export function imageWidth(uri: string): Promise<number> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, width => resolve(width), reject);
  });
}
