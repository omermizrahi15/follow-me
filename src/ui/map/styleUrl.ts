/**
 * Which MapLibre style the globe renders.
 *
 * Satellite imagery is what gives the map its look, and every satellite source
 * needs an account. MapTiler's key is an EXPO_PUBLIC_ value on purpose: it ends
 * up in the client either way, and MapTiler's own protection is the allowed-
 * origins list on the key, not secrecy. Restrict the key in the MapTiler
 * dashboard rather than trying to hide it here.
 *
 * With no key configured the globe still works — it falls back to MapLibre's
 * free demo tiles, which are plain vector world tiles with no imagery. That
 * keeps a fresh checkout runnable without signing up for anything.
 */

const MAPTILER_KEY = (process.env.EXPO_PUBLIC_MAPTILER_KEY as string | undefined) ?? '';

/** Vector satellite + labels — the Polarsteps-like look. */
const MAPTILER_HYBRID = 'https://api.maptiler.com/maps/hybrid/style.json';
/** No key: MapLibre's public demo style. Works, but no imagery. */
const DEMO_STYLE = 'https://demotiles.maplibre.org/style.json';

export function globeStyleUrl(): string {
  if (MAPTILER_KEY === '') return DEMO_STYLE;
  return `${MAPTILER_HYBRID}?key=${encodeURIComponent(MAPTILER_KEY)}`;
}

/** True when real imagery is configured — used to explain a plain-looking globe. */
export function hasSatelliteImagery(): boolean {
  return MAPTILER_KEY !== '';
}
