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

// Supabase Realtime requires WebSocket — stub it so the client can be
// constructed (auth tests don't exercise Realtime at all).
(global as unknown as Record<string, unknown>).WebSocket = class {
  close(): void {}
};

import { createClient } from '@supabase/supabase-js';
import type { AppSupabaseClient } from '../supabase/types';
import { SupabaseAuthService } from './SupabaseAuthService';

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined;
const supabaseKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] as string | undefined;
const testPhone = process.env['AUTH_TEST_PHONE'] as string | undefined;
// Fixed OTP for a Supabase "test phone number" — lets the verify flow run
// without a real WhatsApp send. Configure both in Supabase → Auth → Phone.
const testOtp = process.env['AUTH_TEST_OTP'] as string | undefined;
const RUN = supabaseUrl && supabaseKey;

const describeIf = (cond: unknown): jest.Describe => (cond ? describe : describe.skip);

// The service now takes the client rather than building one (issue #115). Each
// call gets a fresh client so a test that signs in cannot leak its session into
// the next — the AsyncStorage mock above is cleared between tests to match.
function makeService(): SupabaseAuthService {
  const client = createClient(supabaseUrl!, supabaseKey!, {
    auth: {
      storage: inMemoryStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }) as AppSupabaseClient;
  return new SupabaseAuthService(client);
}

describeIf(RUN)('SupabaseAuthService (integration)', () => {
  beforeEach(() => asyncStorageStore.clear());

  describe('getSession', () => {
    it('returns null when no session is active', async (): Promise<void> => {
      const service = makeService();
      const session = await service.getSession();
      expect(session).toBeNull();
    });
  });

  describe('signInWithPhoneOtp', () => {
    it('reaches the Supabase auth API for a valid phone number (WhatsApp delivery is a separate concern)', async (): Promise<void> => {
      if (!testPhone) { console.warn('Skipping: AUTH_TEST_PHONE not set'); return; }
      const service = makeService();
      await service.signInWithPhoneOtp(testPhone);
    });

    it('throws for an invalid phone format', async (): Promise<void> => {
      const service = makeService();
      await expect(
        service.signInWithPhoneOtp('not-a-phone'),
      ).rejects.toThrow();
    });
  });

  describe('verifyPhoneOtp', () => {
    it('throws when given a bogus code', async (): Promise<void> => {
      const service = makeService();
      await expect(
        service.verifyPhoneOtp('+15555550100', '000000'),
      ).rejects.toThrow();
    });

    it('verifies the OTP and establishes a phone session (Supabase test number)', async (): Promise<void> => {
      if (!testPhone || !testOtp) {
        console.warn('Skipping: AUTH_TEST_PHONE / AUTH_TEST_OTP not set');
        return;
      }
      const service = makeService();

      // For a Supabase test number the OTP is fixed, so verify directly —
      // re-requesting here would hit Supabase's per-number rate limit.
      await service.verifyPhoneOtp(testPhone, testOtp);

      const session = await service.getSession();
      expect(session).not.toBeNull();
      expect(session?.user.phone).toBe(testPhone.replace('+', ''));

      await service.signOut();
    });
  });

  describe('onAuthStateChange', () => {
    it('returns an unsubscribe function without throwing', (): void => {
      const service = makeService();
      const unsubscribe = service.onAuthStateChange(() => {});
      expect(typeof unsubscribe).toBe('function');
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe('signOut', () => {
    it('resolves without throwing when no session is active', async (): Promise<void> => {
      const service = makeService();
      await expect(service.signOut()).resolves.not.toThrow();
    });
  });
});
