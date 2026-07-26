import type { TravelRoute } from '../../domain/services/travelRoute';

/**
 * MapLibre GL JS version loaded inside the WebView. Pinned exactly (never a
 * range) — the page is the app's UI, so the bytes it runs must not change
 * without a code review. v5 is the first release with globe projection.
 */
export const MAPLIBRE_VERSION = '5.6.1';
const MAPLIBRE_JS = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
const MAPLIBRE_CSS = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
/**
 * Subresource integrity for both files. The library is fetched from a CDN
 * rather than bundled (~900 KB of JS inlined into the RN bundle would cost
 * memory this app has already been killed for — see the watchdog history in
 * issue #77), and the map needs the network for tiles regardless. These hashes
 * are what stops "pinned version" from meaning "whatever the CDN serves":
 * recompute them if MAPLIBRE_VERSION ever changes.
 *
 *   curl -sL https://unpkg.com/maplibre-gl@<v>/dist/<file> | openssl dgst -sha384 -binary | openssl base64 -A
 */
const MAPLIBRE_JS_SRI = 'sha384-/L1njH4bbgNt9Uk3HwJ272N9fxJzRBQCxhtwGkZiqgl+Nxpq2ETUNZhNMNV1RgyW';
const MAPLIBRE_CSS_SRI = 'sha384-Nq6PQ+9vJPvw7U/VfDELyrWoGQMsy0gi6QShhaSrGzkpF5KkM40csg2leky+YMTd';

/** Messages the page posts back to React Native. */
export type GlobeMessage =
  | { type: 'ready' }
  | { type: 'openPosting'; id: string }
  | { type: 'error'; message: string };

export interface GlobeOptions {
  route: TravelRoute;
  /** MapLibre style URL — satellite when a MapTiler key is configured. */
  styleUrl: string;
  /**
   * Screen space hidden behind the bottom sheet, in CSS pixels. The globe is
   * centred in what's actually visible above it, not in the whole viewport.
   */
  bottomPadding: number;
}

/** Embeds a value as a JS literal, safely inside a <script> in an HTML string. */
function toScriptLiteral(value: unknown): string {
  // '</' + 'script>' inside the JSON would close the script block early, and
  // U+2028 / U+2029 are valid JSON but illegal inside a JS string literal.
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * The whole map page. MapLibre Native (and therefore
 * `@maplibre/maplibre-react-native`) is Mercator-only — globe projection
 * exists solely in MapLibre GL JS v5 — so the globe runs as a web page inside
 * a WebView. The bridge is deliberately tiny: the route goes in as one JSON
 * literal, and the only thing that comes back is which posting was tapped.
 */
export function buildGlobeHtml({ route, styleUrl, bottomPadding }: GlobeOptions): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<link href="${MAPLIBRE_CSS}" rel="stylesheet" integrity="${MAPLIBRE_CSS_SRI}" crossorigin="anonymous" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #0b1a2b; }
  /* The globe sits on deep space, like the profile screen it replaces. */
  .maplibregl-ctrl-attrib { font-size: 9px; opacity: 0.6; }
  .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right { bottom: ${Math.round(bottomPadding)}px; }
  .stop {
    width: 54px; height: 54px; border-radius: 50%;
    border: 3px solid #fff; padding: 0; background: #14324a;
    box-shadow: 0 2px 10px rgba(0,0,0,0.45);
    overflow: hidden; cursor: pointer; -webkit-tap-highlight-color: transparent;
    transition: transform 120ms ease-out;
  }
  .stop:active { transform: scale(1.12); }
  .stop img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
</head>
<body>
<div id="map"></div>
<script src="${MAPLIBRE_JS}" integrity="${MAPLIBRE_JS_SRI}" crossorigin="anonymous"></script>
<script>
(function () {
  var ROUTE = ${toScriptLiteral(route)};
  var STYLE_URL = ${toScriptLiteral(styleUrl)};
  var BOTTOM_PADDING = ${Math.round(bottomPadding)};

  function post(message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  window.onerror = function (message) { post({ type: 'error', message: String(message) }); };

  // Centre on the most recent stop so "where am I now" is what you see first;
  // with no stops at all, a neutral view of the planet.
  var last = ROUTE.stops.length > 0 ? ROUTE.stops[ROUTE.stops.length - 1].position : [10, 25];

  var map = new maplibregl.Map({
    container: 'map',
    style: STYLE_URL,
    center: last,
    // Low enough that the whole sphere sits inside the visible band with space
    // around it, the way the globe reads on a profile screen. Anything past ~2
    // and the planet is cropped by the viewport.
    zoom: 0.9,
    attributionControl: { compact: true },
  });
  // The sheet covers the lower part of the screen, so the globe is centred in
  // what is left above it. Set after construction: padding passed to the
  // constructor is ignored, which silently centres the globe behind the sheet.
  map.setPadding({ top: 0, left: 0, right: 0, bottom: BOTTOM_PADDING });
  map.on('error', function (e) { post({ type: 'error', message: String((e && e.error && e.error.message) || 'map error') }); });

  /**
   * Plane icon, drawn at runtime rather than shipped as an asset. The glyph
   * points north-east, and MapLibre rotates a line-placed icon from "pointing
   * east", so it is pre-rotated 45° clockwise to line up with the leg.
   */
  function planeIcon() {
    var size = 64;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.translate(size / 2, size / 2);
    ctx.rotate(Math.PI / 4);
    ctx.font = '42px -apple-system, "Segoe UI Symbol", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText('\\u2708', 0, 0);
    return ctx.getImageData(0, 0, size, size);
  }

  map.on('load', function () {
    map.setProjection({ type: 'globe' });

    var icon = planeIcon();
    if (!map.hasImage('plane')) {
      map.addImage('plane', { width: icon.width, height: icon.height, data: icon.data });
    }

    map.addSource('route', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: ROUTE.legs.map(function (leg) {
          return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: leg.path } };
        }),
      },
    });

    // A dark casing under the white route. Without it a white dashed line
    // disappears over pale terrain (shallow sea, desert, snow) — the route has
    // to stay legible whatever the imagery underneath happens to be.
    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#0b1a2b',
        'line-width': 4,
        'line-opacity': 0.35,
        'line-dasharray': [1.5, 2],
      },
    });

    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': 2,
        'line-opacity': 0.9,
        'line-dasharray': [1.5, 2],
      },
    });

    // One plane per leg, sitting at the middle of its arc.
    map.addLayer({
      id: 'route-plane',
      type: 'symbol',
      source: 'route',
      layout: {
        'icon-image': 'plane',
        'icon-size': 0.62,
        'symbol-placement': 'line-center',
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });

    ROUTE.stops.forEach(function (stop) {
      var el = document.createElement('button');
      el.className = 'stop';
      el.setAttribute('aria-label', stop.place || stop.date);
      if (stop.thumbUrl) {
        var img = document.createElement('img');
        img.src = stop.thumbUrl;
        img.decoding = 'async';
        el.appendChild(img);
      }
      el.addEventListener('click', function () { post({ type: 'openPosting', id: stop.id }); });
      // Markers default to 20% opacity when they are on the FAR side of the
      // globe, which reads as ghost photos floating in space. Hide them
      // outright: a stop you cannot see is a stop that is not there.
      new maplibregl.Marker({ element: el, opacityWhenCovered: '0' })
        .setLngLat(stop.position)
        .addTo(map);
    });

    startDrift();
    post({ type: 'ready' });
  });

  /**
   * The slow idle drift the globe has when you open the page — one revolution
   * every four minutes, so it reads as alive rather than as motion. It stops
   * for good on the first touch: nothing should move under the user's finger,
   * and it never resumes to fight them.
   */
  var SECONDS_PER_REVOLUTION = 240;
  var drifting = true;
  function startDrift() {
    map.on('moveend', drift);
    ['mousedown', 'touchstart', 'wheel', 'dragstart'].forEach(function (event) {
      map.on(event, function () { drifting = false; });
    });
    drift();
  }
  function drift() {
    // Only while zoomed out far enough that rotation reads as the planet
    // turning; once the user is looking at a place, hold still.
    if (!drifting || map.getZoom() > 3.5) return;
    var center = map.getCenter();
    center.lng += 360 / SECONDS_PER_REVOLUTION;
    map.easeTo({ center: center, duration: 1000, easing: function (n) { return n; } });
  }
}());
</script>
</body>
</html>`;
}
