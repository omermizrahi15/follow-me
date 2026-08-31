import { loadConfig } from '../../composition/container';
import { postingConfigKey } from '../data/queries';
import type { Frequency } from '../../domain/entities/PublisherConfig';
import { useCachedQuery } from './useCachedQuery';

/**
 * How often the publisher posts — just the cadence, from the shared cache.
 *
 * Home needs it to work out which stretches of the trip have no posting yet,
 * and that answer is only as good as the cadence it is measured with. The gap
 * detector used to assume `weekly` for everyone, so a publisher posting every
 * three days had their history carved into seven-day windows: a week with a
 * single post in it counted as fully covered, and the four days either side of
 * it were never offered for reconstruction.
 *
 * Cached rather than loaded per screen, because the whole config is already
 * read by the auto-posting form and this is the same row. Saving the config
 * invalidates the key (see `ui/data/queries`).
 */
export function usePostingFrequency(publisherId: string | null): Frequency | null {
  const { data } = useCachedQuery(
    publisherId != null ? postingConfigKey(publisherId) : null,
    async (): Promise<Frequency | null> => {
      // Unreachable while signed out: a null key means the query never runs.
      if (publisherId == null) return null;
      try {
        return (await loadConfig.execute(publisherId)).frequency;
      } catch {
        // A cadence we could not read is not a cadence to guess at: the caller
        // treats null as "don't measure gaps yet" rather than assuming weekly.
        return null;
      }
    },
  );
  return data ?? null;
}
