export interface AuthUrlCallbacks {
  setSession(accessToken: string, refreshToken: string): Promise<void>;
  exchangeCodeForSession(code: string): Promise<void>;
}

export function parseHashParams(url: string): Record<string, string> {
  const hash = url.split('#')[1] ?? '';
  const result: Record<string, string> = {};
  hash.split('&').forEach(pair => {
    const [k, v] = pair.split('=');
    if (k && v) result[k] = decodeURIComponent(v);
  });
  return result;
}

export function parseQueryParams(url: string): Record<string, string> {
  const query = url.split('?')[1]?.split('#')[0] ?? '';
  const result: Record<string, string> = {};
  query.split('&').forEach(pair => {
    const [k, v] = pair.split('=');
    if (k && v) result[k] = decodeURIComponent(v);
  });
  return result;
}

export function handleAuthUrl(url: string, callbacks: AuthUrlCallbacks): void {
  const hash = parseHashParams(url);
  if (hash.access_token != null && hash.refresh_token != null) {
    void callbacks.setSession(hash.access_token, hash.refresh_token);
    return;
  }
  const query = parseQueryParams(url);
  if (query.code != null) {
    void callbacks.exchangeCodeForSession(query.code);
  }
}
