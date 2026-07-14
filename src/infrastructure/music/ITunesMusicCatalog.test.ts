import { ITunesMusicCatalog } from './ITunesMusicCatalog';

const mockFetch = jest.fn();
(global as unknown as Record<string, unknown>).fetch = mockFetch;

const VIENNA = {
  trackName: 'Vienna',
  artistName: 'Billy Joel',
  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/abc/100x100bb.jpg',
  previewUrl: 'https://audio-ssl.itunes.apple.com/vienna-preview.m4a',
  trackViewUrl: 'https://music.apple.com/us/album/vienna/158617952',
};

function mockResults(results: Array<Record<string, unknown>>): void {
  mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ resultCount: results.length, results }) });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('ITunesMusicCatalog', () => {
  it('searches the song entity with the encoded term and an abort signal', async () => {
    mockResults([]);
    await new ITunesMusicCatalog().searchSongs('billy joel vienna', 5);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://itunes.apple.com/search?media=music&entity=song&limit=5&term=billy%20joel%20vienna',
      { signal: expect.any(AbortSignal) as AbortSignal },
    );
  });

  it('maps results to Songs with display-sized artwork', async () => {
    mockResults([VIENNA]);
    expect(await new ITunesMusicCatalog().searchSongs('vienna')).toEqual([
      {
        title: 'Vienna',
        artist: 'Billy Joel',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/abc/600x600bb.jpg',
        previewUrl: VIENNA.previewUrl,
        sourceUrl: VIENNA.trackViewUrl,
      },
    ]);
  });

  it('skips results missing a track or artist name', async () => {
    mockResults([{ trackName: '', artistName: 'X' }, { artistName: 'No Track' }, VIENNA]);
    const songs = await new ITunesMusicCatalog().searchSongs('vienna');
    expect(songs).toHaveLength(1);
    expect(songs[0]?.title).toBe('Vienna');
  });

  it('keeps a result that has no preview or artwork', async () => {
    mockResults([{ trackName: 'Obscure', artistName: 'Someone' }]);
    expect(await new ITunesMusicCatalog().searchSongs('obscure')).toEqual([
      { title: 'Obscure', artist: 'Someone' },
    ]);
  });

  it('returns [] for a blank term without calling the network', async () => {
    expect(await new ITunesMusicCatalog().searchSongs('   ')).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns [] on an HTTP error instead of throwing', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    expect(await new ITunesMusicCatalog().searchSongs('vienna')).toEqual([]);
  });

  it('returns [] on a network failure instead of throwing', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await new ITunesMusicCatalog().searchSongs('vienna')).toEqual([]);
  });
});
