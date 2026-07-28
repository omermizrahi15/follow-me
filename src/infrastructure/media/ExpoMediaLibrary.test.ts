jest.mock('react-native', () => ({
  Image: { getSize: jest.fn() },
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-media-library', () => ({
  getAssetInfoAsync: jest.fn(),
  MediaType: { photo: 'photo' },
  SortBy: { creationTime: 'creationTime' },
}));

jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' },
}));

import { Image } from 'react-native';
import { manipulateAsync } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { expoResolvePayload } from './ExpoMediaLibrary';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';

// eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, not a real method
const mockGetSize = Image.getSize as unknown as jest.Mock;
const mockManipulate = manipulateAsync as unknown as jest.Mock;
// eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, not a real method
const mockReadFile = FileSystem.readAsStringAsync as unknown as jest.Mock;

function setImageWidth(width: number): void {
  mockGetSize.mockImplementation((_uri: string, onSuccess: (w: number, h: number) => void) => {
    onSuccess(width, Math.round(width * 0.75));
  });
}

const candidate: PhotoCandidate = {
  id: 'asset-1',
  uri: 'file:///photos/a.jpg',
  createdAt: new Date('2026-07-01T00:00:00Z'),
};

describe('expoResolvePayload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManipulate.mockResolvedValue({ uri: 'file:///tmp/small.jpg', base64: 'c21hbGw=' });
  });

  // Full-resolution base64 held across CONCURRENCY in-flight requests (and
  // duplicated by JSON.stringify) is what the iOS watchdog kills the app for.
  it('downscales oversized photos before encoding them', async (): Promise<void> => {
    setImageWidth(4032);

    const payload = await expoResolvePayload(candidate);

    expect(mockManipulate).toHaveBeenCalledWith(
      'file:///photos/a.jpg',
      [{ resize: { width: 1024 } }],
      expect.objectContaining({ base64: true, format: 'jpeg' }),
    );
    expect(payload).toEqual({ id: 'asset-1', base64: 'c21hbGw=', mimeType: 'image/jpeg' });
  });

  it('does not resize a photo that is already small enough', async (): Promise<void> => {
    setImageWidth(800);

    await expoResolvePayload(candidate);

    expect(mockManipulate).toHaveBeenCalledWith(
      'file:///photos/a.jpg',
      [],
      expect.objectContaining({ base64: true }),
    );
  });

  it('never reads the original file into memory', async (): Promise<void> => {
    setImageWidth(4032);
    await expoResolvePayload(candidate);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('skips the photo instead of falling back to full-resolution bytes', async (): Promise<void> => {
    setImageWidth(4032);
    mockManipulate.mockRejectedValueOnce(new Error('decode failed'));

    await expect(expoResolvePayload(candidate)).resolves.toBeNull();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('skips a photo that could not be resolved to a local file', async (): Promise<void> => {
    const remote: PhotoCandidate = { ...candidate, uri: 'ph://asset-1' };
    const { getAssetInfoAsync } = jest.requireMock<{ getAssetInfoAsync: jest.Mock }>(
      'expo-media-library',
    );
    // iCloud-only photo: no localUri, so the ph:// handle comes straight back.
    getAssetInfoAsync.mockResolvedValue({});

    await expect(expoResolvePayload(remote)).resolves.toBeNull();
    expect(mockManipulate).not.toHaveBeenCalled();
  });
});
