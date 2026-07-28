import type { IPlaceSearch, PlaceSuggestion } from '../../domain/interfaces';
import { validCoordinate } from '../../domain/services/coordinate';

interface MapTilerFeature {
  id?: string;
  place_name?: string;
  place_type?: string[];
  relevance?: number;
  center?: unknown;
}

/** A search runs per keystroke (debounced); give up fast rather than queue up. */
const TIMEOUT_MS = 6000;
const LIMIT = 6;
/**
 * Below this the provider is guessing rather than matching: "Not A Real Place"
 * comes back as an Australian street address at 0.46, while real place names
 * score 0.9+. Offering a guess would put a pin on the wrong continent.
 */
const MIN_RELEVANCE = 0.8;
/**
 * A posting is "somewhere I was", not a doorstep. Address- and POI-level hits
 * imply a precision the publisher did not give us, so they are dropped —
 * countries, regions, cities and villages all stay.
 */
const TOO_PRECISE = ['address', 'poi'];

/**
 * Place search via MapTiler, used only when a batch carries no GPS at all
 * (see IPlaceSearch). The key is the same one the globe uses for tiles: a
 * picker is a few calls per post against a 100k/month allowance, unlike the
 * per-tile spend, so it costs nothing in practice.
 *
 * Never throws — a failed lookup shows no suggestions rather than breaking the
 * post flow. An aborted request (the user typed another character) resolves
 * empty rather than surfacing as an error.
 */
export class MapTilerPlaceSearch implements IPlaceSearch {
  constructor(private readonly apiKey: string) {}

  async search(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
    const trimmed = query.trim();
    if (trimmed === '' || this.apiKey === '') return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    // Caller aborts (next keystroke) must cancel this request too.
    signal?.addEventListener('abort', () => controller.abort());

    try {
      const url =
        `https://api.maptiler.com/geocoding/${encodeURIComponent(trimmed)}.json` +
        `?key=${encodeURIComponent(this.apiKey)}&limit=${LIMIT}&language=en`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        if (__DEV__) console.warn(`[place-search] HTTP ${response.status} for "${trimmed}"`);
        return [];
      }
      const body = (await response.json()) as { features?: MapTilerFeature[] };
      return (body.features ?? []).flatMap(toSuggestion);
    } catch {
      // Abort or network failure — no suggestions, no crash.
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

function toSuggestion(feature: MapTilerFeature): PlaceSuggestion[] {
  const type = feature.place_type?.[0];
  if (type != null && TOO_PRECISE.includes(type)) return [];
  if ((feature.relevance ?? 0) < MIN_RELEVANCE) return [];

  // `center` is [longitude, latitude] — GeoJSON order, not lat/lon.
  const center = feature.center;
  if (!Array.isArray(center) || center.length < 2) return [];
  const coordinate = validCoordinate(center[1] as number, center[0] as number);
  if (coordinate == null) return [];

  const label = feature.place_name?.trim();
  if (label == null || label === '') return [];

  return [{ id: feature.id ?? label, label, coordinate }];
}
