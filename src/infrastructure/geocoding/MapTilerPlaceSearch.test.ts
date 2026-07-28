import { MapTilerPlaceSearch } from './MapTilerPlaceSearch';

const mockFetch = jest.fn();
(global as unknown as Record<string, unknown>).fetch = mockFetch;

function mockFeatures(features: unknown[]): void {
  mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ features }) });
}

const LISBON = {
  id: 'place.1',
  place_name: 'Lisbon, Portugal',
  place_type: ['municipality'],
  relevance: 1,
  center: [-9.1393, 38.7223],
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe('MapTilerPlaceSearch', () => {
  it('maps a hit to a label and a coordinate in lat/lon order', async () => {
    mockFeatures([LISBON]);
    const results = await new MapTilerPlaceSearch('key').search('lisbon');
    expect(results).toEqual([
      {
        id: 'place.1',
        label: 'Lisbon, Portugal',
        // center is [lon, lat]; the coordinate must not come back swapped.
        coordinate: { latitude: 38.7223, longitude: -9.1393 },
      },
    ]);
  });

  it('sends the query, the key and an English language hint', async () => {
    mockFeatures([]);
    await new MapTilerPlaceSearch('k3y').search('Rio de Janeiro');
    const calls = mockFetch.mock.calls as unknown as string[][];
    const url = calls[0]?.[0] ?? '';
    expect(url).toContain('/geocoding/Rio%20de%20Janeiro.json');
    expect(url).toContain('key=k3y');
    expect(url).toContain('language=en');
  });

  // The provider always answers, however weak the match — "Not A Real Place"
  // comes back as an Australian street address at relevance 0.46. Offering it
  // would drop a pin on the wrong continent.
  it('drops weak matches', async () => {
    mockFeatures([{ ...LISBON, relevance: 0.46 }]);
    expect(await new MapTilerPlaceSearch('key').search('not a real place')).toEqual([]);
  });

  it('drops address- and POI-level hits as too precise for a posting', async () => {
    mockFeatures([
      { ...LISBON, place_type: ['address'] },
      { ...LISBON, place_type: ['poi'] },
    ]);
    expect(await new MapTilerPlaceSearch('key').search('somewhere')).toEqual([]);
  });

  it('keeps countries and villages, not just cities', async () => {
    mockFeatures([
      { ...LISBON, id: 'c', place_name: 'Sri Lanka', place_type: ['country'], center: [80.7, 7.5] },
      { ...LISBON, id: 'v', place_name: 'Lahugala, Sri Lanka', place_type: ['place'], center: [81.7, 6.8] },
    ]);
    const results = await new MapTilerPlaceSearch('key').search('sri lanka');
    expect(results.map(r => r.label)).toEqual(['Sri Lanka', 'Lahugala, Sri Lanka']);
  });

  it('drops a hit whose coordinate is unusable', async () => {
    mockFeatures([
      { ...LISBON, center: [0, 0] }, // the classic "no fix" marker
      { ...LISBON, center: ['x', 'y'] },
      { ...LISBON, center: undefined },
    ]);
    expect(await new MapTilerPlaceSearch('key').search('nowhere')).toEqual([]);
  });

  it('returns nothing for a blank query without calling the API', async () => {
    expect(await new MapTilerPlaceSearch('key').search('   ')).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns nothing when no key is configured, without calling the API', async () => {
    expect(await new MapTilerPlaceSearch('').search('lisbon')).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Posting must never break because a lookup failed.
  it('returns nothing on an HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    expect(await new MapTilerPlaceSearch('key').search('lisbon')).toEqual([]);
  });

  it('returns nothing when the request throws or is aborted', async () => {
    mockFetch.mockRejectedValueOnce(new Error('aborted'));
    expect(await new MapTilerPlaceSearch('key').search('lisbon')).toEqual([]);
  });

  it("aborts the request when the caller's signal aborts", async () => {
    const controller = new AbortController();
    mockFetch.mockImplementationOnce(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = new MapTilerPlaceSearch('key').search('lis', controller.signal);
    controller.abort();
    expect(await pending).toEqual([]);
  });
});
