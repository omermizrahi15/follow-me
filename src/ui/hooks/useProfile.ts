import { loadProfile } from '../../composition/container';
import type { ProfileDto } from '../../application/dtos';
import { profileKey } from '../data/queries';
import { useCachedQuery } from './useCachedQuery';

interface UseProfile {
  /** The publisher's profile, or null if they haven't set one up yet. */
  profile: ProfileDto | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Local calendar day as "YYYY-MM-DD" — never toISOString, which shifts to UTC. */
function isoDateOnly(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The publisher's profile, from the shared cache (issue #114).
 *
 * Home, the Me header, `useInviteLink` (for the avatar it attaches to the share
 * sheet) and the edit form all call this, and before the cache each one owned
 * its own fetch of the same row. Now they share one.
 *
 * No refresh on focus, unlike the feed: nothing but this app writes a profile,
 * so saving it invalidates the key (see `ui/data/queries`) and every mounted
 * reader updates from that. It also has to work outside a navigator —
 * onboarding shows the invite card above the NavigationContainer.
 */
export function useProfile(publisherId: string | null): UseProfile {
  const { data, loading, reload } = useCachedQuery(
    publisherId != null ? profileKey(publisherId) : null,
    async (): Promise<ProfileDto | null> => {
      // Unreachable while signed out: a null key means the query never runs.
      if (publisherId == null) return null;
      try {
        const profile = await loadProfile.execute(publisherId);
        if (profile == null) return null;
        return {
          publisherId: profile.publisherId,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          tripStartDate: profile.tripStartDate != null ? isoDateOnly(profile.tripStartDate) : null,
        };
      } catch {
        // Treat a load failure as "no profile yet" so the Me page still renders.
        return null;
      }
    },
  );

  return { profile: data ?? null, loading, reload };
}
