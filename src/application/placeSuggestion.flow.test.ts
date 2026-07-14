import { coordinatesForPickedAssets } from '../domain/services/pickedAssetCoordinates';
import type { PickedAssetLike } from '../domain/services/pickedAssetCoordinates';
import { resolvePostingPlace } from './services/resolvePostingPlace';
import type { Coordinate, IGeocoder } from '../domain/interfaces';

/**
 * Flow test for the place-suggestion pipeline exactly as the Upload screen
 * runs it: picked assets → per-photo coordinates (EXIF, then photo-library
 * fallback) → clustering → reverse geocode.
 *
 * THE INVARIANT (regression guard): if at least ONE photo in the batch has a
 * resolvable location — from either source — a place IS suggested. Photos
 * with no location (screenshots, WhatsApp saves, GPS-stripped picker EXIF)
 * must never suppress the suggestion, no matter how many there are or where
 * they sit in the batch.
 */

const TLV: Coordinate = { latitude: 32.08, longitude: 34.78 };

const geocoder: IGeocoder = {
  reverseGeocode: (c: Coordinate) =>
    Promise.resolve(Math.abs(c.latitude - TLV.latitude) < 1 ? 'Tel Aviv, Israel' : null),
};

/** The Upload screen's pipeline, verbatim. */
async function suggestPlace(
  assets: PickedAssetLike[],
  libraryLocations: Record<string, Coordinate | null>,
): Promise<string | null> {
  const coordinates = (
    await coordinatesForPickedAssets(assets, id => Promise.resolve(libraryLocations[id] ?? null))
  ).filter((c): c is Coordinate => c != null);
  return coordinates.length > 0 ? resolvePostingPlace(geocoder, coordinates) : null;
}

const gpsExif = { GPSLatitude: TLV.latitude, GPSLatitudeRef: 'N', GPSLongitude: TLV.longitude, GPSLongitudeRef: 'E' };
const noLocation = (id: string): PickedAssetLike => ({ assetId: id, exif: { Orientation: 6 } });

describe('place suggestion pipeline (Upload screen wiring)', () => {
  it('INVARIANT: one locatable photo among any number of location-less ones always yields a place', async () => {
    // Sweep batch sizes 1..8 with the single GPS photo at every position.
    for (let size = 1; size <= 8; size++) {
      for (let gpsAt = 0; gpsAt < size; gpsAt++) {
        const assets: PickedAssetLike[] = Array.from({ length: size }, (_, i) =>
          i === gpsAt ? { assetId: `gps-${i}`, exif: gpsExif } : noLocation(`none-${i}`),
        );
        const place = await suggestPlace(assets, {});
        expect(place).toBe('Tel Aviv, Israel');
      }
    }
  });

  it('INVARIANT holds when the one location comes from the photo library, not EXIF', async () => {
    const assets = [noLocation('a'), noLocation('b'), noLocation('c')];
    const place = await suggestPlace(assets, { b: TLV });
    expect(place).toBe('Tel Aviv, Israel');
  });

  it('a photo the library throws on is skipped, not fatal', async () => {
    const assets: PickedAssetLike[] = [{ assetId: 'boom', exif: null }, { assetId: 'ok', exif: gpsExif }];
    const coordinates = (
      await coordinatesForPickedAssets(assets, id =>
        id === 'boom' ? Promise.reject(new Error('iCloud timeout')) : Promise.resolve(null),
      )
    ).filter((c): c is Coordinate => c != null);
    const place = await resolvePostingPlace(geocoder, coordinates);
    expect(place).toBe('Tel Aviv, Israel');
  });

  it('suggests nothing only when NO photo has a location anywhere', async () => {
    const place = await suggestPlace([noLocation('a'), noLocation('b')], {});
    expect(place).toBeNull();
  });
});
