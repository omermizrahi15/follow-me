import { useCallback, useEffect, useState } from 'react';
import { loadProfile } from '../../composition/container';
import type { ProfileDto } from '../../application/dtos';

interface ProfileState {
  /** The publisher's profile, or null if they haven't set one up yet. */
  profile: ProfileDto | null;
  loading: boolean;
}

interface UseProfile extends ProfileState {
  reload: () => Promise<void>;
}

/** Local calendar day as "YYYY-MM-DD" — never toISOString, which shifts to UTC. */
function isoDateOnly(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function useProfile(publisherId: string | null): UseProfile {
  const [state, setState] = useState<ProfileState>({ profile: null, loading: true });

  const reload = useCallback(async (): Promise<void> => {
    if (publisherId == null) {
      setState({ profile: null, loading: false });
      return;
    }
    setState(prev => ({ ...prev, loading: true }));
    try {
      const profile = await loadProfile.execute(publisherId);
      setState({
        profile:
          profile == null
            ? null
            : {
                publisherId: profile.publisherId,
                displayName: profile.displayName,
                avatarUrl: profile.avatarUrl,
                tripStartDate:
                  profile.tripStartDate != null ? isoDateOnly(profile.tripStartDate) : null,
              },
        loading: false,
      });
    } catch {
      // Treat a load failure as "no profile yet" so the Me page still renders.
      setState({ profile: null, loading: false });
    }
  }, [publisherId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
