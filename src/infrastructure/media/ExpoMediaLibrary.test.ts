import * as MediaLibrary from 'expo-media-library';
import { ExpoMediaLibrary } from './ExpoMediaLibrary';

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

jest.mock('expo-media-library', () => ({
  MediaType: { photo: 'photo' },
  SortBy: { creationTime: 'creationTime' },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getAssetsAsync: jest.fn(),
  getAssetInfoAsync: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' },
}));

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

const photos: FakeAsset[] = [
  { id: 'before', uri: 'ph://before', creationTime: T('2026-06-07T23:59:59Z') },
  { id: 'on-boundary', uri: 'ph://on-boundary', creationTime: T(BOUNDARY) },
  { id: 'after', uri: 'ph://after', creationTime: T('2026-06-08T00:00:01Z') },
];

beforeEach(() => {
  jest.clearAllMocks();
  getPermissionsAsync.mockResolvedValue({ granted: true });
  libraryContains(photos);
});

const ids = async (start: string, end: string): Promise<string[]> => {
  const found = await new ExpoMediaLibrary().photosBetween(new Date(start), new Date(end));
  return found.map(p => p.id);
};

describe('ExpoMediaLibrary.photosBetween — window boundaries', () => {
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
      ...photos,
      { id: 'shot', uri: 'ph://shot', creationTime: T('2026-06-08T12:00:00Z'), mediaSubtypes: ['screenshot'] },
    ]);
    expect(await ids('2026-06-01T00:00:00Z', '2026-06-15T00:00:00Z')).not.toContain('shot');
  });

  it('paginates until the OS runs out of pages', async () => {
    const pages = [
      { assets: [photos[0]], hasNextPage: true, endCursor: 'c1' },
      { assets: [photos[1]], hasNextPage: true, endCursor: 'c2' },
      { assets: [photos[2]], hasNextPage: false, endCursor: 'c3' },
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

describe('ExpoMediaLibrary.recentPhotos', () => {
  it('is the now-anchored case of photosBetween', async () => {
    const before = Date.now();
    await new ExpoMediaLibrary().recentPhotos(7);

    const [{ createdAfter, createdBefore }] = getAssetsAsync.mock.calls[0] as [
      { createdAfter: number; createdBefore: number },
    ];
    expect(createdBefore).toBeGreaterThanOrEqual(before);
    expect(createdBefore - createdAfter).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
