import { resolvePostingPlace } from './resolvePostingPlace';
import type { Coordinate, IGeocoder } from '../../domain/interfaces';

const TLV: Coordinate = { latitude: 32.08, longitude: 34.78 };
const LISBON: Coordinate = { latitude: 38.72, longitude: -9.14 };
const PORTO: Coordinate = { latitude: 41.15, longitude: -8.61 };

/** Geocoder stub resolving by rough latitude match. */
function geocoderByCity(): IGeocoder {
  return {
    reverseGeocode: (c: Coordinate) => {
      if (Math.abs(c.latitude - TLV.latitude) < 1) return Promise.resolve('Tel Aviv, Israel');
      if (Math.abs(c.latitude - LISBON.latitude) < 1) return Promise.resolve('Lisbon, Portugal');
      if (Math.abs(c.latitude - PORTO.latitude) < 1) return Promise.resolve('Porto, Portugal');
      return Promise.resolve(null);
    },
  };
}

describe('resolvePostingPlace', () => {
  it('a single coordinate is enough for a suggestion', async () => {
    const place = await resolvePostingPlace(geocoderByCity(), [TLV]);
    expect(place).toBe('Tel Aviv, Israel');
  });

  it('same-city batch collapses to one clean name (no duplicates)', async () => {
    const nearby = [TLV, { latitude: 32.09, longitude: 34.79 }, { latitude: 32.07, longitude: 34.77 }];
    const place = await resolvePostingPlace(geocoderByCity(), nearby);
    expect(place).toBe('Tel Aviv, Israel');
  });

  it('multi-city batch names the places, largest group first', async () => {
    const place = await resolvePostingPlace(geocoderByCity(), [LISBON, LISBON, PORTO]);
    expect(place).toBe('Lisbon, Portugal & Porto, Portugal');
  });

  it('one failing geocoder lookup never sinks the others', async () => {
    const flaky: IGeocoder = {
      reverseGeocode: (c: Coordinate) =>
        Math.abs(c.latitude - PORTO.latitude) < 1
          ? Promise.reject(new Error('geocoder 500'))
          : Promise.resolve('Lisbon, Portugal'),
    };
    const place = await resolvePostingPlace(flaky, [LISBON, LISBON, PORTO]);
    expect(place).toBe('Lisbon, Portugal');
  });

  it('geocoder returning null for one cluster still names the rest', async () => {
    const partial: IGeocoder = {
      reverseGeocode: (c: Coordinate) =>
        Promise.resolve(Math.abs(c.latitude - TLV.latitude) < 1 ? 'Tel Aviv, Israel' : null),
    };
    const place = await resolvePostingPlace(partial, [PORTO, TLV]);
    expect(place).toBe('Tel Aviv, Israel');
  });

  it('null only when there is truly nothing to name (no coordinates at all)', async () => {
    const place = await resolvePostingPlace(geocoderByCity(), []);
    expect(place).toBeNull();
  });
});
