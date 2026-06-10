import type { IStorageService } from '../../domain/interfaces';

export class CloudinaryStorageService implements IStorageService {
  constructor(
    private cloudName: string,
    private uploadPreset: string,
  ) {}

  async upload(localUri: string, filename: string): Promise<string> {
    const formData = new FormData();
    formData.append('file', { uri: localUri, type: 'image/jpeg', name: filename } as unknown as Blob);
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
