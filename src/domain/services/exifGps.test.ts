import { gpsFromExif } from './exifGps';

describe('gpsFromExif', () => {
  it('reads iOS-style EXIF: positive degrees with hemisphere refs', () => {
    const coord = gpsFromExif({
      GPSLatitude: 38.7223,
      GPSLatitudeRef: 'N',
      GPSLongitude: 9.1393,
      GPSLongitudeRef: 'W',
    });
    expect(coord).toEqual({ latitude: 38.7223, longitude: -9.1393 });
  });

  it('applies southern hemisphere ref as negative latitude', () => {
    const coord = gpsFromExif({
      GPSLatitude: 33.8688,
      GPSLatitudeRef: 'S',
      GPSLongitude: 151.2093,
      GPSLongitudeRef: 'E',
    });
    expect(coord).toEqual({ latitude: -33.8688, longitude: 151.2093 });
  });

  it('reads Android-style EXIF: signed degrees without refs', () => {
    const coord = gpsFromExif({ GPSLatitude: -33.8688, GPSLongitude: 151.2093 });
    expect(coord).toEqual({ latitude: -33.8688, longitude: 151.2093 });
  });

  it('reads degrees provided as strings', () => {
    const coord = gpsFromExif({ GPSLatitude: '38.7223', GPSLongitude: '-9.1393' });
    expect(coord).toEqual({ latitude: 38.7223, longitude: -9.1393 });
  });

  it('returns null when EXIF is missing', () => {
    expect(gpsFromExif(null)).toBeNull();
    expect(gpsFromExif(undefined)).toBeNull();
    expect(gpsFromExif({})).toBeNull();
  });

  it('returns null when only one axis is present', () => {
    expect(gpsFromExif({ GPSLatitude: 38.7223 })).toBeNull();
    expect(gpsFromExif({ GPSLongitude: -9.1393 })).toBeNull();
  });

  it('returns null for out-of-range coordinates', () => {
    expect(gpsFromExif({ GPSLatitude: 91, GPSLongitude: 0 })).toBeNull();
    expect(gpsFromExif({ GPSLatitude: 0, GPSLongitude: 181 })).toBeNull();
  });

  it('treats exact (0, 0) as no fix', () => {
    expect(gpsFromExif({ GPSLatitude: 0, GPSLongitude: 0 })).toBeNull();
  });

  it('returns null for unparseable strings', () => {
    expect(gpsFromExif({ GPSLatitude: 'abc', GPSLongitude: '9.1' })).toBeNull();
  });
});
