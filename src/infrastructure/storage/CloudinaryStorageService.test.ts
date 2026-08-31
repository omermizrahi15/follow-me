jest.mock('react-native', () => ({
  Image: {
    getSize: jest.fn(),
  },
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

import { CloudinaryStorageService } from './CloudinaryStorageService';
import { Image } from 'react-native';
import { manipulateAsync } from 'expo-image-manipulator';

// eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, not a real method
const mockGetSize = Image.getSize as unknown as jest.Mock;
const mockManipulate = manipulateAsync as unknown as jest.Mock;

/** Make Image.getSize report the given width. */
function setImageWidth(width: number): void {
  mockGetSize.mockImplementation((_uri: string, onSuccess: (w: number, h: number) => void) => {
    onSuccess(width, Math.round(width * 0.75));
  });
}

const mockFetch = jest.fn();
(global as unknown as Record<string, unknown>).fetch = mockFetch;

let lastFormData: Map<string, unknown>;
class MockFormData {
  constructor() { lastFormData = new Map(); }
  append(key: string, value: unknown): void { lastFormData.set(key, value); }
}
(global as unknown as Record<string, unknown>).FormData = MockFormData;

function makeSut(folder?: string): CloudinaryStorageService {
  return new CloudinaryStorageService('my-cloud', 'my-preset', folder);
}

function mockSuccess(secureUrl = 'https://res.cloudinary.com/test/photo.jpg'): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ secure_url: secureUrl }),
  });
}

function mockFailure(status: number, body: string): void {
  mockFetch.mockResolvedValueOnce({ ok: false, status, text: () => Promise.resolve(body) });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockGetSize.mockReset();
  mockManipulate.mockReset();
  setImageWidth(4032); // typical iPhone photo
  mockManipulate.mockResolvedValue({ uri: 'file:///cache/resized.jpg', width: 2048, height: 1536 });
});

describe('CloudinaryStorageService — pre-upload resize', () => {
  it('downscales photos wider than 2048px', async () => {
    setImageWidth(4032);
    mockSuccess();
    await makeSut().upload('file:///photo.heic', 'photo.heic');
    expect(mockManipulate).toHaveBeenCalledWith(
      'file:///photo.heic',
      [{ resize: { width: 2048 } }],
      { compress: 0.8, format: 'jpeg' },
    );
  });

  it('re-encodes without resizing when already small enough', async () => {
    setImageWidth(1200);
    mockSuccess();
    await makeSut().upload('file:///small.png', 'small.png');
    expect(mockManipulate).toHaveBeenCalledWith(
      'file:///small.png',
      [],
      { compress: 0.8, format: 'jpeg' },
    );
  });

  it('uploads the manipulated file as a JPEG multipart part', async () => {
    mockSuccess();
    await makeSut().upload('file:///photo.heic', 'IMG_0042.heic');
    expect(lastFormData.get('file')).toEqual({
      uri: 'file:///cache/resized.jpg',
      name: 'IMG_0042.jpg',
      type: 'image/jpeg',
    });
    expect(lastFormData.get('upload_preset')).toBe('my-preset');
  });

  it('falls back to the original file when manipulation fails', async () => {
    mockManipulate.mockRejectedValueOnce(new Error('cannot decode'));
    mockSuccess();
    await makeSut().upload('file:///photo.jpg', 'photo.jpg');
    expect(lastFormData.get('file')).toEqual({
      uri: 'file:///photo.jpg',
      name: 'photo.jpg',
      type: 'image/jpeg',
    });
  });

  it('falls back to the original file when the size probe fails', async () => {
    mockGetSize.mockImplementation((_uri: string, _ok: unknown, onError: (e: Error) => void) => {
      onError(new Error('unsupported uri'));
    });
    mockSuccess();
    await makeSut().upload('file:///photo.jpg', 'photo.jpg');
    expect(mockManipulate).not.toHaveBeenCalled();
    expect(lastFormData.get('file')).toEqual({
      uri: 'file:///photo.jpg',
      name: 'photo.jpg',
      type: 'image/jpeg',
    });
  });
});

describe('CloudinaryStorageService — endpoint and response handling', () => {
  it('posts to the image upload endpoint', async () => {
    mockSuccess();
    await makeSut().upload('file:///photo.jpg', 'photo.jpg');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudinary.com/v1_1/my-cloud/image/upload',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns the secure_url from the response', async () => {
    mockSuccess('https://res.cloudinary.com/my-cloud/image/upload/v1/abc.jpg');
    const url = await makeSut().upload('file:///photo.jpg', 'photo.jpg');
    expect(url).toBe('https://res.cloudinary.com/my-cloud/image/upload/v1/abc.jpg');
  });

  it('throws with status and body on upload failure', async () => {
    mockFailure(413, 'File size too large');
    await expect(makeSut().upload('file:///photo.jpg', 'photo.jpg')).rejects.toThrow(
      'Cloudinary upload failed (413): File size too large',
    );
  });
});

describe('CloudinaryStorageService — environment folder', () => {
  it('sends the folder when one is configured (staging isolation)', async () => {
    mockSuccess();
    await makeSut('staging').upload('file:///photo.jpg', 'photo.jpg');
    expect(lastFormData.get('folder')).toBe('staging');
  });

  it('omits the folder param when none is configured', async () => {
    mockSuccess();
    await makeSut().upload('file:///photo.jpg', 'photo.jpg');
    expect(lastFormData.has('folder')).toBe(false);
  });
});

describe('CloudinaryStorageService — failure messages', () => {
  it('reports the message from a Cloudinary JSON error (issue #177)', async () => {
    mockFailure(400, JSON.stringify({ error: { message: 'Invalid image file' } }));
    await expect(makeSut().upload('file:///photo.jpg', 'photo.jpg')).rejects.toThrow(
      'Cloudinary upload failed (400): Invalid image file',
    );
  });
});
