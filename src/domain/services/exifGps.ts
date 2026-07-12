import type { Coordinate } from '../interfaces';
import { validCoordinate } from './coordinate';

/**
 * GPS fields as they appear in picker EXIF data. iOS reports positive degrees
 * plus a hemisphere ref ('N'/'S', 'E'/'W'); Android usually reports signed
 * degrees (sometimes as strings) with no ref.
 */
export interface GpsExif {
  GPSLatitude?: number | string;
  GPSLatitudeRef?: string;
  GPSLongitude?: number | string;
  GPSLongitudeRef?: string;
}

function toDegrees(value: number | string | undefined, ref: string | undefined): number | null {
  const degrees = typeof value === 'string' ? Number(value) : value;
  if (degrees == null || Number.isNaN(degrees)) return null;
  // A hemisphere ref carries the sign; apply it to the magnitude.
  if (ref === 'S' || ref === 'W') return -Math.abs(degrees);
  return degrees;
}

/** Extracts the photo's GPS coordinate from EXIF, or null when absent/invalid. */
export function gpsFromExif(exif: GpsExif | null | undefined): Coordinate | null {
  if (exif == null) return null;
  const latitude = toDegrees(exif.GPSLatitude, exif.GPSLatitudeRef);
  const longitude = toDegrees(exif.GPSLongitude, exif.GPSLongitudeRef);
  if (latitude == null || longitude == null) return null;
  return validCoordinate(latitude, longitude);
}
