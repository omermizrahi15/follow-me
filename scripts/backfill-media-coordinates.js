#!/usr/bin/env node
/**
 * One-time backfill for the Me-page globe (issue #78).
 *
 * Posts published before migration 20240022 kept only a place LABEL
 * ("Rio de Janeiro, Brazil"), never the coordinate — the GPS fix lived on
 * candidate_photos and was dropped at publish time. Without a coordinate a post
 * cannot be plotted, so the route would start out nearly empty.
 *
 * This fills media.latitude/longitude for rows that have a location label and
 * no coordinate, in two passes:
 *   1. exact — the row's own candidate_photos entry (same asset id), which is
 *      the real GPS fix and is preferred whenever it survived retention;
 *   2. geocoded — forward-geocode the label to a city centre via MapTiler.
 *      City-level accuracy, which is all a route map needs for old posts.
 *
 * Labels are looked up once and cached, so N posts in one city cost one
 * request — a backfill is a handful of calls, not a dent in the quota.
 *
 * Only the one-off FORWARD lookup uses MapTiler. Live reverse geocoding stays
 * on BigDataCloud (src/infrastructure/geocoding, supabase/functions/_shared):
 * it is keyless and unmetered, whereas MapTiler bills per request and every
 * map tile the globe loads already draws on that same quota.
 *
 * Usage (defaults to a dry run; nothing is written without --apply):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... EXPO_PUBLIC_MAPTILER_KEY=... \
 *     node scripts/backfill-media-coordinates.js
 *   …same, plus --apply, to actually write.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY ?? process.env.MAPTILER_KEY;
const APPLY = process.argv.includes('--apply');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}
if (!MAPTILER_KEY) {
  console.error('EXPO_PUBLIC_MAPTILER_KEY is required to geocode place labels');
  process.exit(1);
}

const MAPTILER_GEOCODE = 'https://api.maptiler.com/geocoding';
/** Courtesy pacing — the backfill is not in a hurry and the quota is shared. */
const RATE_LIMIT_MS = 200;
/** Below this, the "match" is the geocoder guessing. See geocode() for why. */
const MIN_RELEVANCE = 0.9;

/** Same rejection rules as domain/services/coordinate.ts — keep them in step. */
function validCoordinate(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { latitude: lat, longitude: lon };
}

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const geocodeCache = new Map();

async function geocode(label) {
  if (geocodeCache.has(label)) return geocodeCache.get(label);
  // `types=municipality` keeps the answer at city granularity. Without it
  // MapTiler happily resolves to a street address, which is both wrong for a
  // route map and more precise than a years-old post should imply.
  const url =
    `${MAPTILER_GEOCODE}/${encodeURIComponent(label)}.json` +
    `?key=${encodeURIComponent(MAPTILER_KEY)}&limit=1&types=municipality&language=en`;
  let coordinate = null;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const body = await res.json();
      const hit = body?.features?.[0];
      // MapTiler always answers, however weak the match: "Not A Real Place"
      // comes back as "Real, Philippines" with relevance 0.37, and a post
      // pinned to the wrong continent is worse than a post left off the map.
      // Real city labels score 1.0; junk scores at or below 0.5.
      if (hit != null && (hit.relevance ?? 0) >= MIN_RELEVANCE) {
        // `center` is [longitude, latitude] — GeoJSON order, not lat/lon.
        const center = hit.center;
        if (Array.isArray(center)) coordinate = validCoordinate(center[1], center[0]);
      } else if (hit != null) {
        console.warn(`  geocode "${label}" → rejected weak match "${hit.place_name}" (relevance ${hit.relevance})`);
      }
    } else {
      console.warn(`  geocode "${label}" → HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn(`  geocode "${label}" failed:`, e.message);
  }
  geocodeCache.set(label, coordinate);
  await sleep(RATE_LIMIT_MS);
  return coordinate;
}

async function main() {
  console.log(APPLY ? 'Backfilling media coordinates…' : 'DRY RUN (pass --apply to write)');

  const rows = await rest('media?select=id,location,latitude,longitude&latitude=is.null&order=created_at.asc');
  const needing = rows.filter(r => r.location != null && r.location.trim() !== '');
  console.log(`${rows.length} rows without a coordinate; ${needing.length} have a place label`);
  if (rows.length !== needing.length) {
    console.log(`${rows.length - needing.length} row(s) have neither and stay off the map`);
  }

  // Pass 1: the real fix, when the candidate row outlived the 35-day retention.
  const candidates = await rest('candidate_photos?select=asset_id,latitude,longitude&latitude=not.is.null');
  const byAsset = new Map(candidates.map(c => [c.asset_id, c]));

  let exact = 0;
  let geocoded = 0;
  let unresolved = 0;

  for (const row of needing) {
    const candidate = byAsset.get(row.id);
    let coordinate = candidate != null ? validCoordinate(candidate.latitude, candidate.longitude) : null;
    let source = 'candidate GPS';

    if (coordinate == null) {
      coordinate = await geocode(row.location);
      source = 'geocoded label';
    }

    if (coordinate == null) {
      unresolved++;
      console.log(`  ✗ ${row.id} "${row.location}" — unresolved`);
      continue;
    }

    if (source === 'candidate GPS') exact++;
    else geocoded++;

    console.log(
      `  ✓ ${row.id} "${row.location}" → ${coordinate.latitude.toFixed(4)},${coordinate.longitude.toFixed(4)} (${source})`,
    );

    if (APPLY) {
      await rest(`media?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ latitude: coordinate.latitude, longitude: coordinate.longitude }),
      });
    }
  }

  console.log(`\n${exact} from candidate GPS, ${geocoded} geocoded, ${unresolved} unresolved`);
  if (!APPLY) console.log('Nothing was written — re-run with --apply.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
