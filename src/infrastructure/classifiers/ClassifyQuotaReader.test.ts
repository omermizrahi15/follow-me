import { ClassifyQuotaReader } from './ClassifyQuotaReader';

const mockFetch = jest.fn();
(global as unknown as Record<string, unknown>).fetch = mockFetch;

function jsonResponse(body: unknown, status = 200): unknown {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function makeSut(getAccessToken?: () => Promise<string | null>): ClassifyQuotaReader {
  return new ClassifyQuotaReader('https://fn.test/classify-photos', 'anon-key', getAccessToken);
}

beforeEach(() => mockFetch.mockReset());

describe('ClassifyQuotaReader', () => {
  it('asks the classify function for today’s usage', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ used: 137, limit: 500, day: '2026-08-28' }));

    const snapshot = await makeSut(() => Promise.resolve('jwt')).read();

    expect(snapshot).toEqual({ used: 137, limit: 500, day: '2026-08-28' });
    const [url, init] = mockFetch.mock.calls[0] as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe('https://fn.test/classify-photos');
    expect(init.method).toBe('GET');
    // The endpoint rejects the anon key on its own — the signed-in user's JWT
    // is what identifies whose quota row to read.
    expect(init.headers.Authorization).toBe('Bearer jwt');
    expect(init.headers.apikey).toBe('anon-key');
  });

  it('falls back to the anon key when no session provider is wired', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ used: 0, limit: 500, day: '2026-08-28' }));

    await makeSut().read();

    const [, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe('Bearer anon-key');
  });

  it('fails rather than reporting an empty budget when signed out', async () => {
    // Zero used of zero allowed is a real state (classification switched off),
    // so inventing it for a missing token would paint a full red bar on a
    // publisher whose budget is untouched.
    await expect(makeSut(() => Promise.resolve(null)).read()).rejects.toThrow(/not signed in/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails on a refused request', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Authentication required' }, 401));

    await expect(makeSut(() => Promise.resolve('jwt')).read()).rejects.toThrow(/401/);
  });

  it('fails on a body that is missing the numbers', async () => {
    // An older deployment of the function answers the GET with its 405. A
    // snapshot built from undefined would render NaN.
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Method not allowed' }));

    await expect(makeSut(() => Promise.resolve('jwt')).read()).rejects.toThrow(/unreadable|unexpected/i);
  });
});
