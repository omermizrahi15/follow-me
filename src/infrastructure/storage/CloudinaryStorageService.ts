import { File } from 'expo-file-system';
import type { IStorageService } from '../../domain/interfaces';

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

export class CloudinaryStorageService implements IStorageService {
  constructor(
    private cloudName: string,
    private uploadPreset: string,
  ) {}

  async upload(localUri: string, filename: string): Promise<string> {
    const base64 = await new File(localUri).base64();
    const mimeType = getMimeType(filename);

    const formData = new FormData();
    formData.append('file', `data:${mimeType};base64,${base64}`);
    formData.append('upload_preset', this.uploadPreset);

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
}
