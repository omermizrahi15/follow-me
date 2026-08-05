// What the owner-only RLS policies (migration 20240031) rest on: a repository
// query made through the shared client carries the signed-in user's JWT, so it
// runs as `authenticated` with a real `auth.uid()`. Repositories used to build
// their own `persistSession: false` clients and every query went out as `anon`
// (issue #115) — under the new policies that reads nothing at all.
//
// rls.integration.test.ts proves the same thing against the real database; this
// asserts it on the wire with no network, so it runs in the normal suite.

// AsyncStorage requires browser APIs not available in Node — swap it for an
// in-memory store so the Supabase client can initialise without crashing.
const asyncStorageStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem:    (k: string): Promise<string | null> => Promise.resolve(asyncStorageStore.get(k) ?? null),
    setItem:    (k: string, v: string): Promise<void> => { asyncStorageStore.set(k, v); return Promise.resolve(); },
    removeItem: (k: string): Promise<void> => { asyncStorageStore.delete(k); return Promise.resolve(); },
  },
}));

// Supabase Realtime requires WebSocket — stub it so the client can construct.
(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

// `requireEnv` is where the client picks up its project URL and key, and it runs
// when the module loads — mocking it (hoisted above the imports) is what points
// the client at a fake project. The literals are repeated below as ANON_KEY:
// a jest.mock factory cannot close over outer variables.
jest.mock('../env', () => ({
  requireEnv: (_value: string | undefined, name: string): string =>
    name === 'EXPO_PUBLIC_SUPABASE_URL' ? 'https://probe.supabase.co' : 'test-anon-key',
}));

import { supabase } from './client';
import { SupabaseAuthService } from '../auth/SupabaseAuthService';
import { SupabaseSubscriberRepository } from '../repositories/SupabaseSubscriberRepository';

const ANON_KEY = 'test-anon-key';

/** A syntactically real JWT — nothing verifies it, the server is stubbed. */
function fakeJwt(): string {
  const encode = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    // Far-future expiry so the client uses the token as-is instead of refreshing.
    encode({ sub: 'user-1', role: 'authenticated', exp: 4102444800 }),
    // Three characters keeps the segment decodable as base64url.
    'sig',
  ].join('.');
}

const ACCESS_TOKEN = fakeJwt();

/** Every outgoing request's Authorization header, in order. */
const sent: { url: string; authorization: string | null }[] = [];

beforeAll(() => {
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    sent.push({ url, authorization: headers.get('Authorization') });
    // Adopting a session makes the client verify the token against /auth/v1/user.
    const body = url.includes('/auth/v1/user')
      ? JSON.stringify({ id: 'user-1', aud: 'authenticated', role: 'authenticated' })
      : '[]';
    return Promise.resolve(
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  };
});

/** The Authorization header the most recent PostgREST (table) request used. */
function lastTableAuth(): string | null {
  const rest = sent.filter(r => r.url.includes('/rest/v1/'));
  return rest[rest.length - 1]?.authorization ?? null;
}

describe('the shared Supabase client', () => {
  it('sends the anon key on a repository query while signed out', async (): Promise<void> => {
    await new SupabaseAuthService(supabase).signOut();
    sent.length = 0;

    await new SupabaseSubscriberRepository(supabase).findActiveByPublisher('pub-1');

    expect(lastTableAuth()).toBe(`Bearer ${ANON_KEY}`);
  });

  it("sends the signed-in user's JWT on a repository query", async (): Promise<void> => {
    // Signing in happens on the same client the repositories query through —
    // that shared instance is the whole point.
    await supabase.auth.setSession({ access_token: ACCESS_TOKEN, refresh_token: 'refresh' });
    sent.length = 0;

    await new SupabaseSubscriberRepository(supabase).findActiveByPublisher('pub-1');

    expect(lastTableAuth()).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(lastTableAuth()).not.toBe(`Bearer ${ANON_KEY}`);
  });

  it('falls back to the anon key again after sign-out', async (): Promise<void> => {
    await new SupabaseAuthService(supabase).signOut();
    sent.length = 0;

    await new SupabaseSubscriberRepository(supabase).findActiveByPublisher('pub-1');

    expect(lastTableAuth()).toBe(`Bearer ${ANON_KEY}`);
  });
});
