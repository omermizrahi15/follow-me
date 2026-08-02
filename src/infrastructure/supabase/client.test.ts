// The point of the shared client (issue #115): a repository query carries the
// signed-in user's JWT. Every repository used to build its own
// `persistSession: false` client, so every read and write in the app went out as
// the `anon` role — which is why RLS can't be scoped to `auth.uid()` yet
// (issue #9). This asserts on the wire: what Authorization header a repository's
// query actually leaves with, signed in and signed out.

// AsyncStorage requires browser APIs not available in Node — swap it for an
// in-memory store so the Supabase client can initialise without crashing.
const asyncStorageStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem:     (k: string): Promise<string | null> => Promise.resolve(asyncStorageStore.get(k) ?? null),
    setItem:     (k: string, v: string): Promise<void> => { asyncStorageStore.set(k, v); return Promise.resolve(); },
    removeItem:  (k: string): Promise<void> => { asyncStorageStore.delete(k); return Promise.resolve(); },
  },
}));

// Supabase Realtime requires WebSocket — stub it so the client can construct.
(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

// The client reads its env on first use, so pointing it at a fake project has
// to happen before any query. Restored afterwards — jest workers share one
// process.env across test files.
const ANON_KEY = 'test-anon-key';
const realEnv = {
  url: process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined,
  key: process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] as string | undefined,
};
process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'https://probe.supabase.co';
process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = ANON_KEY;
afterAll(() => {
  process.env['EXPO_PUBLIC_SUPABASE_URL'] = realEnv.url;
  process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = realEnv.key;
});

import { supabase } from './client';
import { SupabaseAuthService } from '../auth/SupabaseAuthService';
import { SupabaseSubscriberRepository } from '../repositories/SupabaseSubscriberRepository';

/** A syntactically real JWT (never verified here — the server is stubbed). */
function fakeJwt(): string {
  const encode = (o: unknown): string =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    // Far-future expiry so the client uses it as-is instead of refreshing.
    encode({ sub: 'user-1', role: 'authenticated', exp: 4102444800 }),
    // A 3-char tail keeps the segment decodable as base64url; nothing verifies it.
    'sig',
  ].join('.');
}

const ACCESS_TOKEN = fakeJwt();

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
