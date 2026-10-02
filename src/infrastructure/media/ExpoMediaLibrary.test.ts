jest.mock('react-native', () => ({
  Image: { getSize: jest.fn() },
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-media-library', () => ({
  getAssetInfoAsync: jest.fn(),
  getAssetsAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  MediaType: { photo: 'photo' },
  SortBy: { creationTime: 'creationTime' },
}));

jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  EncodingType: { Base64: 'base64' },
}));

import { Image } from 'react-native';
import { manipulateAsync } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { ExpoMediaLibrary, expoResolvePayload } from './ExpoMediaLibrary';
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

/**
 * The window contract the history backfill depends on (issue #81): a window is
 * `[start, end)` — inclusive start, EXCLUSIVE end. Adjacent windows share a
 * boundary instant, so if both ends were inclusive the photo taken exactly on
 * it would be suggested for two different postings, and the publisher would
 * see the same shot twice in their reconstructed timeline.
 *
 * The OS filters are inclusive on some platforms, which is why the adapter
 * re-checks each asset in JS. These tests pin that down.
 */

const getPermissionsAsync = MediaLibrary.getPermissionsAsync as jest.Mock;
const requestPermissionsAsync = MediaLibrary.requestPermissionsAsync as jest.Mock;
const getAssetsAsync = MediaLibrary.getAssetsAsync as jest.Mock;

interface FakeAsset {
  id: string;
  uri: string;
  creationTime: number;
  mediaSubtypes?: string[];
}

/** Serves assets the way the OS does: one page, already filtered by the query. */
function libraryContains(assets: FakeAsset[]): void {
  getAssetsAsync.mockImplementation((options: { createdAfter?: number; createdBefore?: number }) => {
    // Deliberately INCLUSIVE on both ends — this is the permissive behaviour the
    // adapter must correct, not the behaviour it may rely on.
    const after = options.createdAfter ?? -Infinity;
    const before = options.createdBefore ?? Infinity;
    return Promise.resolve({
      assets: assets.filter(a => a.creationTime >= after && a.creationTime <= before),
      hasNextPage: false,
      endCursor: '0',
    });
  });
}

const T = (iso: string): number => new Date(iso).getTime();

const BOUNDARY = '2026-06-08T00:00:00Z';

const windowPhotos: FakeAsset[] = [
  { id: 'before', uri: 'ph://before', creationTime: T('2026-06-07T23:59:59Z') },
  { id: 'on-boundary', uri: 'ph://on-boundary', creationTime: T(BOUNDARY) },
  { id: 'after', uri: 'ph://after', creationTime: T('2026-06-08T00:00:01Z') },
];

const ids = async (start: string, end: string): Promise<string[]> => {
  const found = await new ExpoMediaLibrary().photosBetween(new Date(start), new Date(end));
  return found.map(p => p.id);
};

/** Granted permission + the three-photo library, unless a test says otherwise. */
function givenLibrary(): void {
  jest.clearAllMocks();
  getPermissionsAsync.mockResolvedValue({ granted: true });
  libraryContains(windowPhotos);
}

describe('ExpoMediaLibrary.photosBetween — window boundaries', () => {
  beforeEach(givenLibrary);

  it('includes a photo taken exactly at the window start', async () => {
    expect(await ids(BOUNDARY, '2026-06-15T00:00:00Z')).toContain('on-boundary');
  });

  it('excludes a photo taken exactly at the window end', async () => {
    expect(await ids('2026-06-01T00:00:00Z', BOUNDARY)).not.toContain('on-boundary');
  });

  it('INVARIANT: adjacent windows claim a boundary photo exactly once', async () => {
    const older = await ids('2026-06-01T00:00:00Z', BOUNDARY);
    const newer = await ids(BOUNDARY, '2026-06-15T00:00:00Z');

    // No photo appears in both windows...
    expect(older.filter(id => newer.includes(id))).toEqual([]);
    // ...and none falls through the crack between them either.
    expect([...older, ...newer].sort()).toEqual(['after', 'before', 'on-boundary']);
  });

  it('keeps photos strictly inside the window', async () => {
    expect(await ids('2026-06-07T00:00:00Z', '2026-06-09T00:00:00Z')).toEqual([
      'before', 'on-boundary', 'after',
    ]);
  });

  it('asks the OS to filter by the same window it enforces', async () => {
    await ids('2026-06-01T00:00:00Z', BOUNDARY);
    expect(getAssetsAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        createdAfter: T('2026-06-01T00:00:00Z'),
        createdBefore: T(BOUNDARY),
      }),
    );
  });

  it('returns nothing — without touching the library — for an empty or inverted window', async () => {
    expect(await ids(BOUNDARY, BOUNDARY)).toEqual([]);
    expect(await ids('2026-06-15T00:00:00Z', '2026-06-01T00:00:00Z')).toEqual([]);
    expect(getAssetsAsync).not.toHaveBeenCalled();
  });

  it('drops screenshots even when they fall inside the window', async () => {
    libraryContains([
      ...windowPhotos,
      { id: 'shot', uri: 'ph://shot', creationTime: T('2026-06-08T12:00:00Z'), mediaSubtypes: ['screenshot'] },
    ]);
    expect(await ids('2026-06-01T00:00:00Z', '2026-06-15T00:00:00Z')).not.toContain('shot');
  });

  it('paginates until the OS runs out of pages', async () => {
    const pages = [
      { assets: [windowPhotos[0]], hasNextPage: true, endCursor: 'c1' },
      { assets: [windowPhotos[1]], hasNextPage: true, endCursor: 'c2' },
      { assets: [windowPhotos[2]], hasNextPage: false, endCursor: 'c3' },
    ];
    let call = 0;
    getAssetsAsync.mockImplementation(() => Promise.resolve(pages[call++]));

    expect(await ids('2026-06-01T00:00:00Z', '2026-06-15T00:00:00Z')).toEqual([
      'before', 'on-boundary', 'after',
    ]);
    expect(getAssetsAsync).toHaveBeenCalledTimes(3);
  });

  it('requests permission when it has not been granted yet, and fails loudly if refused', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: false });
    requestPermissionsAsync.mockResolvedValue({ granted: false });

    await expect(ids('2026-06-01T00:00:00Z', '2026-06-15T00:00:00Z')).rejects.toThrow(
      /permission not granted/,
    );
  });
});


describe('ExpoMediaLibrary — describeAssets', () => {
  const candidate = (id: string): PhotoCandidate => ({
    id, uri: `ph://${id}`, createdAt: new Date('2026-08-01T10:00:00Z'),
  });

  beforeEach(() => {
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockReset();
    (FileSystem.getInfoAsync as jest.Mock).mockReset();
  });

  it('fills in the favourite flag and the file size', async () => {
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockResolvedValue({
      uri: 'ph://a', localUri: 'file:///a.jpg', isFavorite: true,
    });
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 3_100_000 });

    const [described] = await new ExpoMediaLibrary().describeAssets([candidate('a')]);

    expect(described?.isFavorite).toBe(true);
    expect(described?.byteSize).toBe(3_100_000);
  });

  // Without this the pass would pull every iCloud original down just to read
  // its size, turning a metadata read into a multi-gigabyte one.
  it('never downloads an original just to measure it', async () => {
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockResolvedValue({ uri: 'ph://a' });
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });

    await new ExpoMediaLibrary().describeAssets([candidate('a')]);

    expect(MediaLibrary.getAssetInfoAsync).toHaveBeenCalledWith('a', {
      shouldDownloadFromNetwork: false,
    });
  });

  // Zero is a real size that the burst ranking reads as "no detail at all", so
  // an unreadable file would be ranked last for being unreadable.
  it('reports no size rather than a zero one', async () => {
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockResolvedValue({ uri: 'ph://a' });
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 0 });

    const [described] = await new ExpoMediaLibrary().describeAssets([candidate('a')]);

    expect(described?.byteSize).toBeUndefined();
  });

  it('hands back the photo unchanged when the library throws', async () => {
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockRejectedValue(new Error('gone'));

    const input = candidate('a');
    const [described] = await new ExpoMediaLibrary().describeAssets([input]);

    expect(described).toEqual(input);
  });

  it('keeps the order it was given, so the caller can zip the results back', async () => {
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockImplementation((id: string) =>
      Promise.resolve({ uri: `ph://${id}` }),
    );
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });

    const described = await new ExpoMediaLibrary().describeAssets(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map(candidate),
    );

    expect(described.map(c => c.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
  });
});
