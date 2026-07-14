import { EdgeFunctionSongSuggester } from './EdgeFunctionSongSuggester';
import type { IMusicCatalog } from '../../domain/interfaces';
import type { Song } from '../../domain/entities/Song';

const mockFetch = jest.fn();
(global as unknown as Record<string, unknown>).fetch = mockFetch;

const FN_URL = 'https://project.supabase.co/functions/v1/suggest-song';
const ANON_KEY = 'anon-key';

const VIENNA: Song = {
  title: 'Vienna',
  artist: 'Billy Joel',
  artworkUrl: 'https://art/vienna.jpg',
  previewUrl: 'https://preview/vienna.m4a',
  sourceUrl: 'https://music/vienna',
};

function mockCandidates(candidates: Array<{ title: string; artist: string; reason?: string }>): void {
  mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ candidates }) });
}

function catalogReturning(byTerm: Record<string, Song[]>): IMusicCatalog {
  return {
    searchSongs: jest.fn((term: string) => Promise.resolve(byTerm[term] ?? [])),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('EdgeFunctionSongSuggester', () => {
  it('returns null without a network call when the function url is not configured', async () => {
    const suggester = new EdgeFunctionSongSuggester('', ANON_KEY, catalogReturning({}));
    expect(await suggester.suggest({ place: 'Lisbon' })).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('posts the context with the signed-in JWT and resolves candidates through the catalog', async () => {
    mockCandidates([{ title: 'Vienna', artist: 'Billy Joel', reason: 'classic' }]);
    const catalog = catalogReturning({ 'Vienna Billy Joel': [VIENNA] });
    const suggester = new EdgeFunctionSongSuggester(
      FN_URL, ANON_KEY, catalog, () => Promise.resolve('user-jwt'),
    );

    const songs = await suggester.suggest({ place: 'Lisbon, Portugal', photoCount: 3 });

    expect(mockFetch).toHaveBeenCalledWith(FN_URL, expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer user-jwt',
        apikey: ANON_KEY,
      }) as Record<string, string>,
    }));
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, unknown>;
    expect(body.place).toBe('Lisbon, Portugal');
    expect(body.photoCount).toBe(3);
    expect(songs).toEqual([VIENNA]);
  });

  it('falls back to the bare candidate when the catalog has no match', async () => {
    mockCandidates([{ title: 'Ultra Obscure', artist: 'Nobody' }]);
    const suggester = new EdgeFunctionSongSuggester(FN_URL, ANON_KEY, catalogReturning({}));
    expect(await suggester.suggest({})).toEqual([{ title: 'Ultra Obscure', artist: 'Nobody' }]);
  });

  it('inlines downsized photos so the AI sees the post', async () => {
    mockCandidates([]);
    const readPhoto = jest.fn((uri: string) =>
      Promise.resolve({ base64: `b64:${uri}`, mimeType: 'image/jpeg' }));
    const suggester = new EdgeFunctionSongSuggester(
      FN_URL, ANON_KEY, catalogReturning({}), undefined, readPhoto,
    );

    await suggester.suggest({ photoUris: ['file:///a.jpg', 'file:///b.jpg'] });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, unknown>;
    expect(body.photos).toEqual([
      { base64: 'b64:file:///a.jpg', mimeType: 'image/jpeg' },
      { base64: 'b64:file:///b.jpg', mimeType: 'image/jpeg' },
    ]);
  });

  it('samples first/middle/last when the posting has many photos', async () => {
    mockCandidates([]);
    const readPhoto = jest.fn((uri: string) =>
      Promise.resolve({ base64: `b64:${uri}`, mimeType: 'image/jpeg' }));
    const suggester = new EdgeFunctionSongSuggester(
      FN_URL, ANON_KEY, catalogReturning({}), undefined, readPhoto,
    );

    await suggester.suggest({ photoUris: ['u0', 'u1', 'u2', 'u3', 'u4'] });

    expect(readPhoto.mock.calls.map(c => c[0])).toEqual(['u0', 'u2', 'u4']);
  });

  it('skips unreadable photos instead of failing the suggestion', async () => {
    mockCandidates([{ title: 'Vienna', artist: 'Billy Joel' }]);
    const readPhoto = jest.fn(() => Promise.reject(new Error('unreadable')));
    const suggester = new EdgeFunctionSongSuggester(
      FN_URL, ANON_KEY, catalogReturning({}), undefined, readPhoto,
    );

    const songs = await suggester.suggest({ photoUris: ['file:///broken.jpg'] });

    expect(songs).toHaveLength(1);
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, unknown>;
    expect(body.photos).toBeUndefined();
  });

  it('sends the exclude list so rerolls do not repeat songs', async () => {
    mockCandidates([]);
    const suggester = new EdgeFunctionSongSuggester(FN_URL, ANON_KEY, catalogReturning({}));
    await suggester.suggest({ exclude: [VIENNA] });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, unknown>;
    expect(body.exclude).toEqual([{ title: 'Vienna', artist: 'Billy Joel' }]);
  });

  it('returns null on an HTTP error instead of throwing', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502 });
    const suggester = new EdgeFunctionSongSuggester(FN_URL, ANON_KEY, catalogReturning({}));
    expect(await suggester.suggest({})).toBeNull();
  });

  it('returns null on a network failure instead of throwing', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    const suggester = new EdgeFunctionSongSuggester(FN_URL, ANON_KEY, catalogReturning({}));
    expect(await suggester.suggest({})).toBeNull();
  });
});
