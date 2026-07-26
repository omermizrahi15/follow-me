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
 *   2. geocoded — forward-geocode the label to a city centre via Nominatim.
 *      City-level accuracy, which is all a route map needs for old posts.
 *
 * Labels are looked up once and cached, so N posts in one city cost one
 * request. Nominatim's usage policy caps us at 1 req/s — respected below.
 *
 * Usage (defaults to a dry run; nothing is written without --apply):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-media-coordinates.js
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-media-coordinates.js --apply
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.argv.includes('--apply');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
// Nominatim requires an identifying User-Agent and at most one request/second.
const USER_AGENT = 'follow-me-backfill/1.0 (https://github.com/omermizrahi15/follow-me)';
const RATE_LIMIT_MS = 1100;

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
  const url = `${NOMINATIM}?q=${encodeURIComponent(label)}&format=json&limit=1`;
  let coordinate = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      const hits = await res.json();
      const hit = Array.isArray(hits) ? hits[0] : null;
      // Nominatim returns lat/lon as strings — coerce, exactly like the iOS
      // media-library case that validCoordinate exists for.
      if (hit != null) coordinate = validCoordinate(hit.lat, hit.lon);
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
