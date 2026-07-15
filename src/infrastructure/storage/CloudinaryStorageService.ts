import { Image } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { IStorageService } from '../../domain/interfaces';

/**
 * Photos are downscaled + re-encoded to JPEG before upload:
 * - a full-res iPhone photo (3–8MB, sometimes >10MB) exceeds Cloudinary's
 *   free-plan file cap and takes ~10s+ per photo on a phone uplink;
 * - 2048px @ 0.8 quality is ~300–800KB with no visible loss at feed sizes.
 * The file is sent as multipart (not base64, which inflates bytes by ~33%
 * and holds the whole photo in memory).
 */
const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.8;

/** React Native's FormData file part — {uri, name, type} instead of a Blob. */
interface UploadableFile {
  uri: string;
  name: string;
  type: string;
}

function imageWidth(uri: string): Promise<number> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, width => resolve(width), reject);
  });
}

export class CloudinaryStorageService implements IStorageService {
  /**
   * `folder` routes uploads into a Cloudinary folder (an allowed unsigned-upload
   * param) so staging builds never mix assets with production — set via
   * EXPO_PUBLIC_CLOUDINARY_FOLDER, absent in production.
   */
  constructor(
    private cloudName: string,
    private uploadPreset: string,
    private folder?: string,
  ) {}

  async upload(localUri: string, filename: string): Promise<string> {
    const file = await this.prepareFile(localUri, filename);

    const formData = new FormData();
    formData.append('file', file as unknown as Blob);
    formData.append('upload_preset', this.uploadPreset);
    if (this.folder) formData.append('folder', this.folder);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${this.cloudName}/image/upload`,
      { method: 'POST', body: formData },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cloudinary upload failed (${response.status}): ${text}`);
    }

    const data = await response.json() as { secure_url: string };
    return data.secure_url;
  }

  /**
   * Downscale (when larger than MAX_DIMENSION) and re-encode as JPEG.
   * Falls back to the original file when manipulation fails — an oversized
   * upload attempt is better than not posting at all.
   */
  private async prepareFile(localUri: string, filename: string): Promise<UploadableFile> {
    try {
      const width = await imageWidth(localUri);
      const actions = width > MAX_DIMENSION ? [{ resize: { width: MAX_DIMENSION } }] : [];
      const out = await manipulateAsync(localUri, actions, {
        compress: JPEG_QUALITY,
        format: SaveFormat.JPEG,
      });
      const baseName = filename.replace(/\.[A-Za-z0-9]+$/, '') || 'photo';
      return { uri: out.uri, name: `${baseName}.jpg`, type: 'image/jpeg' };
    } catch {
      return { uri: localUri, name: filename, type: 'image/jpeg' };
    }
  }
}
