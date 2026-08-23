import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "Has this install been through onboarding?" — persisted so first-launch
 * onboarding never shows twice.
 *
 * It lives here rather than inside `useOnboarding` because it is also read
 * outside React: the photo-sync migration uses it to tell an install that
 * predates the on-by-default build from a fresh one, and that runs at module
 * scope on a background launch where no hook ever mounts.
 */
const ONBOARDING_KEY = '@followme/onboarding-completed';

export async function hasCompletedOnboarding(): Promise<boolean> {
  // Unreadable storage reads as "not onboarded", which shows onboarding again
  // rather than crashing — the same fail-open the hook has always used.
  const value = await AsyncStorage.getItem(ONBOARDING_KEY).catch(() => null);
  return value === 'true';
}

export async function markOnboardingCompleted(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
}
