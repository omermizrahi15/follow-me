import { BigDataCloudGeocoder } from './BigDataCloudGeocoder';

const mockFetch = jest.fn();
(global as unknown as Record<string, unknown>).fetch = mockFetch;

const LISBON = { latitude: 38.7223, longitude: -9.1393 };

function mockResponse(body: Record<string, unknown>): void {
  mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('BigDataCloudGeocoder', () => {
  it('calls the client endpoint with the coordinate and an abort signal', async () => {
    mockResponse({ city: 'Lisbon', countryName: 'Portugal' });
    await new BigDataCloudGeocoder().reverseGeocode(LISBON);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=38.7223&longitude=-9.1393&localityLanguage=en',
      { signal: expect.any(AbortSignal) as AbortSignal },
    );
  });

  it('gives up after the timeout instead of stalling the share', async () => {
    jest.useFakeTimers();
    try {
      // A fetch that never settles until its signal aborts.
      mockFetch.mockImplementationOnce(
        (_url: string, opts: { signal: AbortSignal }) =>
          new Promise((_, reject) =>
            opts.signal.addEventListener('abort', () => reject(new Error('Aborted'))),
          ),
      );
      const result = new BigDataCloudGeocoder().reverseGeocode(LISBON);
      jest.advanceTimersByTime(5000);
      await expect(result).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns "City, Country"', async () => {
    mockResponse({ city: 'Lisbon', countryName: 'Portugal' });
    expect(await new BigDataCloudGeocoder().reverseGeocode(LISBON)).toBe('Lisbon, Portugal');
  });

  it('falls back to locality, then region, when city is empty', async () => {
    mockResponse({ city: '', locality: 'Alfama', countryName: 'Portugal' });
    expect(await new BigDataCloudGeocoder().reverseGeocode(LISBON)).toBe('Alfama, Portugal');

    mockResponse({ city: '', locality: '', principalSubdivision: 'Lisbon District', countryName: 'Portugal' });
    expect(await new BigDataCloudGeocoder().reverseGeocode(LISBON)).toBe('Lisbon District, Portugal');
  });

  it('returns country alone when no city-level name resolves', async () => {
    mockResponse({ countryName: 'Portugal' });
    expect(await new BigDataCloudGeocoder().reverseGeocode(LISBON)).toBe('Portugal');
  });

  it('returns null when nothing resolves', async () => {
    mockResponse({});
    expect(await new BigDataCloudGeocoder().reverseGeocode(LISBON)).toBeNull();
  });

  it('returns null on an HTTP error instead of throwing', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    expect(await new BigDataCloudGeocoder().reverseGeocode(LISBON)).toBeNull();
  });

  it('returns null on a network failure instead of throwing', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await new BigDataCloudGeocoder().reverseGeocode(LISBON)).toBeNull();
  });
});
