import { useCallback, useEffect, useState } from 'react';
import { hasCompletedOnboarding, markOnboardingCompleted } from '../data/onboardingFlag';
import { defaultPhotoSyncOn } from '../data/photoSyncConsent';

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
    void hasCompletedOnboarding().then(setCompleted);
  }, []);

  const complete = useCallback(async (): Promise<void> => {
    setCompleted(true);
    // Photo sync is on by default, and this is where the default lands: the
    // auto-posting step records its own "on" when it is reached, but skipping
    // onboarding must not leave the app unable to prepare a post. Before the
    // flag, so nothing observes a finished onboarding with no preference behind
    // it. No-op if the step (or the upgrade migration) already answered.
    await defaultPhotoSyncOn();
    await markOnboardingCompleted();
  }, []);

  return { completed: completed === true, loading: completed === null, complete };
}
