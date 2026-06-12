import { parseHashParams, parseQueryParams, handleAuthUrl } from './authUrlHandler';
import type { AuthUrlCallbacks } from './authUrlHandler';

function makeCallbacks(): { callbacks: AuthUrlCallbacks; setSession: jest.Mock; exchange: jest.Mock } {
  const setSession = jest.fn().mockResolvedValue(undefined);
  const exchange = jest.fn().mockResolvedValue(undefined);
  return {
    callbacks: { setSession, exchangeCodeForSession: exchange },
    setSession,
    exchange,
  };
}

describe('parseHashParams', () => {
  it('extracts access_token and refresh_token from a hash fragment', () => {
    const url = 'followme://auth#access_token=abc&refresh_token=xyz&token_type=bearer';
    expect(parseHashParams(url)).toEqual({
      access_token: 'abc',
      refresh_token: 'xyz',
      token_type: 'bearer',
    });
  });

  it('decodes percent-encoded values', () => {
    const url = 'followme://auth#access_token=hello%20world';
    expect(parseHashParams(url).access_token).toBe('hello world');
  });

  it('returns an empty object when there is no hash', () => {
    expect(parseHashParams('followme://auth')).toEqual({});
  });

  it('ignores malformed pairs with no value', () => {
    const url = 'followme://auth#access_token=abc&bad&refresh_token=xyz';
    const params = parseHashParams(url);
    expect(params.access_token).toBe('abc');
    expect(params.refresh_token).toBe('xyz');
    expect('bad' in params).toBe(false);
  });
});

describe('parseQueryParams', () => {
  it('extracts a code query param', () => {
    const url = 'followme://auth?code=pkce-code-123';
    expect(parseQueryParams(url)).toEqual({ code: 'pkce-code-123' });
  });

  it('does not include the hash fragment in query params', () => {
    const url = 'followme://auth?code=abc#access_token=should-be-ignored';
    expect(parseQueryParams(url)).toEqual({ code: 'abc' });
  });

  it('returns an empty object when there is no query string', () => {
    expect(parseQueryParams('followme://auth')).toEqual({});
  });

  it('decodes percent-encoded values', () => {
    const url = 'followme://auth?code=hello%20world';
    expect(parseQueryParams(url).code).toBe('hello world');
  });
});

describe('handleAuthUrl', () => {
  it('calls setSession when access_token and refresh_token are in the hash', () => {
    const { callbacks, setSession, exchange } = makeCallbacks();
    handleAuthUrl('followme://auth#access_token=acc&refresh_token=ref', callbacks);
    expect(setSession).toHaveBeenCalledWith('acc', 'ref');
    expect(exchange).not.toHaveBeenCalled();
  });

  it('calls exchangeCodeForSession when a code query param is present', () => {
    const { callbacks, setSession, exchange } = makeCallbacks();
    handleAuthUrl('followme://auth?code=pkce-code', callbacks);
    expect(exchange).toHaveBeenCalledWith('pkce-code');
    expect(setSession).not.toHaveBeenCalled();
  });

  it('prefers implicit flow (hash) over PKCE (query) when both are present', () => {
    const { callbacks, setSession, exchange } = makeCallbacks();
    handleAuthUrl('followme://auth?code=c#access_token=a&refresh_token=r', callbacks);
    expect(setSession).toHaveBeenCalledWith('a', 'r');
    expect(exchange).not.toHaveBeenCalled();
  });

  it('does nothing when the URL contains neither tokens nor a code', () => {
    const { callbacks, setSession, exchange } = makeCallbacks();
    handleAuthUrl('followme://auth', callbacks);
    expect(setSession).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });

  it('does nothing when only access_token is present (refresh_token missing)', () => {
    const { callbacks, setSession, exchange } = makeCallbacks();
    handleAuthUrl('followme://auth#access_token=only', callbacks);
    expect(setSession).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });
});
