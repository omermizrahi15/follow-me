import type { Coordinate } from '../interfaces';

// Callers guarantee a non-empty input.
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * The coordinate that stands for a batch of photos: the per-axis median, so a
 * single photo taken somewhere else (an outlier, a screenshot with stale GPS)
 * doesn't drag the posting's place away from where most of the batch was shot.
 */
export function representativeCoordinate(coordinates: Coordinate[]): Coordinate | null {
  if (coordinates.length === 0) return null;
  return {
    latitude: median(coordinates.map(c => c.latitude)),
    longitude: median(coordinates.map(c => c.longitude)),
  };
}
