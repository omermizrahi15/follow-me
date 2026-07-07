import { representativeCoordinates, formatPlaceList } from '../../domain/services/postingLocation';
import type { Coordinate, IGeocoder } from '../../domain/interfaces';

/**
 * Names a batch's place(s): clusters the coordinates into up to 3 major spots
 * (largest photo group first), reverse-geocodes each, dedupes identical names,
 * and joins them ("Lisbon, Portugal & Porto, Portugal"). Null when no
 * coordinate resolves — a share must never block on naming the place.
 * Used by ShareMediaUseCase and by the review screen's editable place field.
 */
export async function resolvePostingPlace(
  geocoder: IGeocoder,
  coordinates: Coordinate[],
): Promise<string | null> {
  const representatives = representativeCoordinates(coordinates, 3);
  const places: string[] = [];
  for (const coordinate of representatives) {
    try {
      const place = await geocoder.reverseGeocode(coordinate);
      // Nearby clusters can resolve to the same "City, Country" — dedupe.
      if (place != null && !places.includes(place)) places.push(place);
    } catch {
      // A failed lookup skips one place, never the whole posting.
    }
  }
  return formatPlaceList(places);
}
