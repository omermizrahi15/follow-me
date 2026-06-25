import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_KEY = '@followme/onboarding-completed';

interface OnboardingState {
  /** Whether the first-launch onboarding has already been completed/skipped. */
  completed: boolean;
  /** True until the persisted flag has been read from AsyncStorage. */
  loading: boolean;
  /** Marks onboarding as done and persists it so it never shows again. */
  complete: () => Promise<void>;
}

export function useOnboarding(): OnboardingState {
  // null = not yet loaded from storage.
  const [completed, setCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(ONBOARDING_KEY)
      .then(value => setCompleted(value === 'true'))
      // If storage is unreadable, fail open and show onboarding rather than crash.
      .catch(() => setCompleted(false));
  }, []);

  const complete = useCallback(async (): Promise<void> => {
    setCompleted(true);
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
  }, []);

  return { completed: completed === true, loading: completed === null, complete };
}
