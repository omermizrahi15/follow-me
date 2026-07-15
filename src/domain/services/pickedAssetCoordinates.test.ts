import { coordinatesForPickedAssets } from './pickedAssetCoordinates';
import type { Coordinate } from '../interfaces';

const TLV: Coordinate = { latitude: 32.08, longitude: 34.78 };
const LISBON: Coordinate = { latitude: 38.72, longitude: -9.14 };

const exifFor = (c: Coordinate): Record<string, unknown> => ({
  GPSLatitude: c.latitude,
  GPSLatitudeRef: 'N',
  GPSLongitude: Math.abs(c.longitude),
  GPSLongitudeRef: c.longitude < 0 ? 'W' : 'E',
});

describe('coordinatesForPickedAssets', () => {
  it('uses EXIF when present and does not hit the library', async () => {
    const lookup = jest.fn();
    const result = await coordinatesForPickedAssets([{ exif: exifFor(TLV), assetId: 'a1' }], lookup);
    expect(result[0]?.latitude).toBeCloseTo(TLV.latitude);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('falls back to the library lookup when EXIF has no GPS (iOS PHPicker strips it)', async () => {
    const lookup = jest.fn().mockResolvedValue(LISBON);
    const result = await coordinatesForPickedAssets(
      [{ exif: { Orientation: 6 }, assetId: 'a1' }], // exif present but GPS-stripped
      lookup,
    );
    expect(result).toEqual([LISBON]);
    expect(lookup).toHaveBeenCalledWith('a1');
  });

  it('mixed batch: every photo resolves independently, order preserved', async () => {
    const lookup = jest.fn().mockResolvedValue(LISBON);
    const result = await coordinatesForPickedAssets(
      [
        { exif: exifFor(TLV), assetId: 'a1' },
        { exif: null, assetId: 'a2' }, // -> library
        { exif: null, assetId: null }, // -> null, but must not sink the batch
      ],
      lookup,
    );
    expect(result[0]?.latitude).toBeCloseTo(TLV.latitude);
    expect(result[1]).toEqual(LISBON);
    expect(result[2]).toBeNull();
  });

  it('a throwing lookup yields null for that photo only', async () => {
    const lookup = jest
      .fn()
      .mockRejectedValueOnce(new Error('iCloud timeout'))
      .mockResolvedValueOnce(LISBON);
    const result = await coordinatesForPickedAssets(
      [{ exif: null, assetId: 'bad' }, { exif: null, assetId: 'good' }],
      lookup,
    );
    expect(result).toEqual([null, LISBON]);
  });

  it('lookup returning null (photo without location) stays null', async () => {
    const lookup = jest.fn().mockResolvedValue(null);
    const result = await coordinatesForPickedAssets([{ exif: null, assetId: 'a1' }], lookup);
    expect(result).toEqual([null]);
  });
});
