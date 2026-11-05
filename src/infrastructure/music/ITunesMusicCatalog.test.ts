import { ITunesMusicCatalog } from './ITunesMusicCatalog';

const mockFetch = jest.fn();
(global as unknown as Record<string, unknown>).fetch = mockFetch;

function respond(results: Array<Record<string, unknown>>): void {
  mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ results }) });
}

beforeEach(() => mockFetch.mockReset());

describe('ITunesMusicCatalog', () => {
  it('searches songs with the encoded term', async () => {
    respond([]);
    await new ITunesMusicCatalog().searchSongs('billy joel');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://itunes.apple.com/search?media=music&entity=song&limit=15&term=billy%20joel',
    );
  });

  it('maps results to songs with larger artwork', async () => {
    respond([{ trackName: 'Vienna', artistName: 'Billy Joel', artworkUrl100: 'https://x/100x100bb.jpg' }]);
    expect(await new ITunesMusicCatalog().searchSongs('vienna')).toEqual([
      { title: 'Vienna', artist: 'Billy Joel', artworkUrl: 'https://x/300x300bb.jpg' },
    ]);
  });

  it('skips results without a title or artist', async () => {
    respond([{ trackName: 'No Artist' }, { artistName: 'No Title' }]);
    expect(await new ITunesMusicCatalog().searchSongs('x')).toEqual([]);
  });

  it('returns [] on an HTTP error or network failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    expect(await new ITunesMusicCatalog().searchSongs('x')).toEqual([]);
    mockFetch.mockRejectedValueOnce(new TypeError('offline'));
    expect(await new ITunesMusicCatalog().searchSongs('x')).toEqual([]);
  });
});
