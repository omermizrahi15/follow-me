// In-memory AsyncStorage — the real one needs a React Native host. Declared
// with a `mock` prefix so jest allows it inside the hoisted factory.
const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
    setItem: jest.fn((k: string, v: string) => { mockStore.set(k, v); return Promise.resolve(); }),
    removeItem: jest.fn((k: string) => { mockStore.delete(k); return Promise.resolve(); }),
    multiRemove: jest.fn((ks: string[]) => { ks.forEach((k) => mockStore.delete(k)); return Promise.resolve(); }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  defaultPhotoSyncOn,
  isPhotoSyncEnabled,
  migratePhotoSyncPreference,
  setPhotoSyncEnabled,
  withdrawPhotoSyncConsent,
} from './photoSyncConsent';

const PREFERENCE_KEY = 'photo-sync-preference-v1';
const LEGACY_CONSENT_KEY = 'photo-sync-consent-v1';
const LEGACY_PAUSED_KEY = 'photo-sync-paused-v1';
const ONBOARDING_KEY = '@followme/onboarding-completed';

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('isPhotoSyncEnabled', () => {
  it('is false before any writer has run, so a fresh install uploads nothing', async () => {
    expect(await isPhotoSyncEnabled()).toBe(false);
  });

  it('is true only for a recorded "on"', async () => {
    mockStore.set(PREFERENCE_KEY, 'on');
    expect(await isPhotoSyncEnabled()).toBe(true);
  });

  it('is false for a recorded "off"', async () => {
    mockStore.set(PREFERENCE_KEY, 'off');
    expect(await isPhotoSyncEnabled()).toBe(false);
  });

  it('reads unreadable storage as off rather than throwing into the caller', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage gone'));
    expect(await isPhotoSyncEnabled()).toBe(false);
  });
});

describe('setPhotoSyncEnabled', () => {
  it('records the choice both ways', async () => {
    await setPhotoSyncEnabled(true);
    expect(await isPhotoSyncEnabled()).toBe(true);

    await setPhotoSyncEnabled(false);
    expect(await isPhotoSyncEnabled()).toBe(false);
  });
});

describe('withdrawPhotoSyncConsent', () => {
  // Issue #72: the cloud wipe did not stick, because the next foreground
  // re-uploaded everything that had just been deleted.
  it('leaves sync off, so a foreground after a cloud wipe re-uploads nothing', async () => {
    await setPhotoSyncEnabled(true);

    await withdrawPhotoSyncConsent();

    expect(await isPhotoSyncEnabled()).toBe(false);
  });
});

describe('defaultPhotoSyncOn', () => {
  it('turns sync on when onboarding ends without a choice being recorded', async () => {
    await defaultPhotoSyncOn();
    expect(await isPhotoSyncEnabled()).toBe(true);
  });

  // The migration's whole point: default-on must never reach a publisher who
  // already said no.
  it('never overrides a recorded "off"', async () => {
    mockStore.set(PREFERENCE_KEY, 'off');

    await defaultPhotoSyncOn();

    expect(await isPhotoSyncEnabled()).toBe(false);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('leaves a recorded "on" alone rather than rewriting it', async () => {
    mockStore.set(PREFERENCE_KEY, 'on');

    await defaultPhotoSyncOn();

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('migratePhotoSyncPreference', () => {
  it('writes nothing on a fresh install, leaving the default to onboarding', async () => {
    await migratePhotoSyncPreference();

    expect(mockStore.has(PREFERENCE_KEY)).toBe(false);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('carries "Allow" forward as on', async () => {
    mockStore.set(ONBOARDING_KEY, 'true');
    mockStore.set(LEGACY_CONSENT_KEY, '2026-01-01T00:00:00Z');

    await migratePhotoSyncPreference();

    expect(await isPhotoSyncEnabled()).toBe(true);
  });

  // A wiping device had also said "Allow" at some earlier point, so the pause
  // flag has to win or the upgrade undoes the wipe.
  it('honours a legacy wipe as off even when consent was also recorded', async () => {
    mockStore.set(ONBOARDING_KEY, 'true');
    mockStore.set(LEGACY_CONSENT_KEY, '2026-01-01T00:00:00Z');
    mockStore.set(LEGACY_PAUSED_KEY, '2026-02-01T00:00:00Z');

    await migratePhotoSyncPreference();

    expect(await isPhotoSyncEnabled()).toBe(false);
  });

  it('reads an onboarded install with no legacy signals as a decline', async () => {
    mockStore.set(ONBOARDING_KEY, 'true');

    await migratePhotoSyncPreference();

    expect(await isPhotoSyncEnabled()).toBe(false);
  });

  it('does not revisit a preference that is already recorded', async () => {
    mockStore.set(ONBOARDING_KEY, 'true');
    mockStore.set(PREFERENCE_KEY, 'off');
    mockStore.set(LEGACY_CONSENT_KEY, '2026-01-01T00:00:00Z');

    await migratePhotoSyncPreference();

    expect(await isPhotoSyncEnabled()).toBe(false);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('retires the legacy keys once the answer they produced is written', async () => {
    mockStore.set(ONBOARDING_KEY, 'true');
    mockStore.set(LEGACY_CONSENT_KEY, '2026-01-01T00:00:00Z');
    mockStore.set(LEGACY_PAUSED_KEY, '2026-02-01T00:00:00Z');

    await migratePhotoSyncPreference();

    expect(mockStore.has(LEGACY_CONSENT_KEY)).toBe(false);
    expect(mockStore.has(LEGACY_PAUSED_KEY)).toBe(false);
  });

  // Dropping them first would leave a failed write with no signals to resolve
  // from, and the retry would read "Allow" as a decline.
  it('keeps the legacy keys when the write fails, so the retry still has signals', async () => {
    mockStore.set(ONBOARDING_KEY, 'true');
    mockStore.set(LEGACY_CONSENT_KEY, '2026-01-01T00:00:00Z');
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));

    await migratePhotoSyncPreference();

    expect(mockStore.get(LEGACY_CONSENT_KEY)).toBe('2026-01-01T00:00:00Z');
    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
  });

  it('reaches the same answer on the launch after a failed write', async () => {
    mockStore.set(ONBOARDING_KEY, 'true');
    mockStore.set(LEGACY_CONSENT_KEY, '2026-01-01T00:00:00Z');
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));

    await migratePhotoSyncPreference();
    await migratePhotoSyncPreference();

    expect(await isPhotoSyncEnabled()).toBe(true);
  });
});
