import { resolveBatchPlace } from '../../domain/services/postingLocation';
import type { Coordinate, IGeocoder } from '../../domain/interfaces';

/**
 * Names a batch's place(s): clusters the coordinates into up to 3 major spots
 * (largest photo group first), reverse-geocodes each, dedupes identical names,
 * and joins them ("Lisbon, Portugal & Porto, Portugal"). Null when no
 * coordinate resolves — a share must never block on naming the place.
 * Used by ShareMediaUseCase and by the review screen's editable place field.
 *
 * The flow itself is in the domain, where the auto-post / post-batch Edge
 * Functions reach it too; this only binds it to the app's geocoder port.
 */
export function resolvePostingPlace(
  geocoder: IGeocoder,
  coordinates: Coordinate[],
): Promise<string | null> {
  return resolveBatchPlace(coordinates, coordinate => geocoder.reverseGeocode(coordinate));
}
