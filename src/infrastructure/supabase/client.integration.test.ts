// Hits the real Supabase project. Proves the point of issue #115: a repository
// query made through the shared client carries the *signed-in user's* JWT, not
// the anon key. Everything used to run as `anon` (each repository built its own
// `persistSession: false` client), which is why RLS still can't be scoped to
// `auth.uid()` — issue #9 depends on this holding.
//
// Skipped automatically unless EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY and the
// Supabase test-phone credentials are set. Run locally with:
//   npm run test:integration

// AsyncStorage requires browser APIs not available in Node — swap it for an
// in-memory store so the Supabase client can initialise without crashing.
const asyncStorageStore = new Map<string, string>();
const inMemoryStorage = {
  getItem:     (k: string): Promise<string | null> => Promise.resolve(asyncStorageStore.get(k) ?? null),
  setItem:     (k: string, v: string): Promise<void> => { asyncStorageStore.set(k, v); return Promise.resolve(); },
  removeItem:  (k: string): Promise<void> => { asyncStorageStore.delete(k); return Promise.resolve(); },
  multiGet:    (keys: string[]): Promise<[string, string | null][]> => Promise.resolve(keys.map(k => [k, asyncStorageStore.get(k) ?? null])),
  multiSet:    (pairs: [string, string][]): Promise<void> => { pairs.forEach(([k, v]) => asyncStorageStore.set(k, v)); return Promise.resolve(); },
  multiRemove: (keys: string[]): Promise<void> => { keys.forEach(k => asyncStorageStore.delete(k)); return Promise.resolve(); },
};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: inMemoryStorage,
}));

// Supabase Realtime requires WebSocket — stub it so the client can construct.
(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

import { supabase } from './client';
import { SupabaseAuthService } from '../auth/SupabaseAuthService';
import { SupabasePublisherConfigRepository } from '../repositories/SupabasePublisherConfigRepository';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined;
const anonKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] as string | undefined;
const testPhone = process.env['AUTH_TEST_PHONE'] as string | undefined;
// Fixed OTP for a Supabase "test phone number" — lets the verify flow run
// without a real WhatsApp send. Configure both in Supabase → Auth → Phone.
const testOtp = process.env['AUTH_TEST_OTP'] as string | undefined;
const RUN = supabaseUrl && anonKey && testPhone && testOtp;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

/** Authorization header of every outgoing request, in order. */
const sent: { url: string; authorization: string | null }[] = [];

function captureFetch(): () => void {
  const real = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    sent.push({ url: input instanceof Request ? input.url : String(input), authorization: headers.get('Authorization') });
    return real(input, init);
  };
  return () => { globalThis.fetch = real; };
}

/** The Authorization the most recent PostgREST (table) request went out with. */
function lastTableAuth(): string | null {
  const rest = sent.filter(r => r.url.includes('/rest/v1/'));
  return rest[rest.length - 1]?.authorization ?? null;
}

describeIf(RUN)('shared Supabase client (integration)', () => {
  let restoreFetch: () => void;

  beforeAll(() => { restoreFetch = captureFetch(); });
  afterAll(async (): Promise<void> => {
    await new SupabaseAuthService(supabase).signOut();
    restoreFetch();
  });

  it('sends the anon key while signed out, and the user JWT once signed in', async (): Promise<void> => {
    const auth = new SupabaseAuthService(supabase);
    const configRepo = new SupabasePublisherConfigRepository(supabase);

    await auth.signOut();
    sent.length = 0;
    await configRepo.findByPublisher('integration-test-jwt-probe');
    expect(lastTableAuth()).toBe(`Bearer ${anonKey!}`);

    // For a Supabase test number the OTP is fixed, so verify directly —
    // re-requesting here would hit Supabase's per-number rate limit.
    await auth.verifyPhoneOtp(testPhone!, testOtp!);
    const session = await auth.getSession();
    expect(session).not.toBeNull();

    sent.length = 0;
    await configRepo.findByPublisher(session!.user.id);
    expect(lastTableAuth()).toBe(`Bearer ${session!.access_token}`);
    expect(lastTableAuth()).not.toBe(`Bearer ${anonKey!}`);
  });
});
