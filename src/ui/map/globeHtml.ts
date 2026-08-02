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
  /**
   * The initial route, already through {@link toScriptLiteral}. A literal
   * rather than the object because the caller holds one anyway: the same
   * string is what it pushes into the live page when the route changes, and
   * comparing those strings is how it knows whether it changed at all.
   */
  routeLiteral: string;
  /** MapLibre style URL — satellite when a MapTiler key is configured. */
  styleUrl: string;
  /**
   * Screen space hidden behind the bottom sheet, in CSS pixels. The globe is
   * centred in what's actually visible above it, not in the whole viewport.
   */
  bottomPadding: number;
}

/** Embeds a value as a JS literal, safely inside a <script> in an HTML string. */
export function toScriptLiteral(value: unknown): string {
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
export function buildGlobeHtml({ routeLiteral, styleUrl, bottomPadding }: GlobeOptions): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<link href="${MAPLIBRE_CSS}" rel="stylesheet" integrity="${MAPLIBRE_CSS_SRI}" crossorigin="anonymous" />
<style>
  /* Kept as a custom property, not a baked-in value: the sheet height can
     change without reloading the page, and __setBottomPadding() below writes
     this one property rather than the document being rebuilt around it. */
  html { margin: 0; padding: 0; height: 100%; width: 100%; background: #05070f; --bottom-padding: ${Math.round(bottomPadding)}px; }
  /*
   * Starfield. The map canvas is transparent outside the sphere, so this sits
   * behind it and shows as deep space around the globe. Built from repeating
   * radial gradients rather than an image: no asset to load, no bytes over the
   * bridge, and it scales to any screen. Three layers at different sizes and
   * offsets keep it from reading as a regular grid.
   */
  body {
    margin: 0; padding: 0; height: 100%; width: 100%;
    background-color: #05070f;
    background-image:
      radial-gradient(1.4px 1.4px at 22px 34px, rgba(255,255,255,0.85), transparent 100%),
      radial-gradient(1.1px 1.1px at 148px 92px, rgba(255,255,255,0.65), transparent 100%),
      radial-gradient(1.6px 1.6px at 76px 178px, rgba(210,232,255,0.75), transparent 100%),
      radial-gradient(1px 1px at 196px 148px, rgba(255,255,255,0.5), transparent 100%),
      radial-gradient(1.2px 1.2px at 118px 26px, rgba(255,255,255,0.6), transparent 100%);
    background-size: 220px 220px, 260px 260px, 300px 300px, 180px 180px, 340px 340px;
    background-repeat: repeat;
  }
  /* Transparent, so the starfield on body and the halo behind it both show
     through everywhere the planet isn't drawn. */
  #map { margin: 0; padding: 0; height: 100%; width: 100%; background: transparent; }
  /*
   * The atmosphere ring. A plain circle sitting BEHIND the map canvas, which is
   * transparent outside the sphere — so only the part that extends past the
   * planet's edge is visible, which is exactly the glow. Even all the way
   * round, unlike MapLibre's own sun-lit atmosphere.
   */
  #glow {
    position: absolute; left: 0; top: 0; border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    opacity: 0;
    transition: opacity 200ms linear;
    box-shadow:
      0 0 0 1px rgba(120, 195, 255, 0.5),
      0 0 18px 4px rgba(80, 170, 255, 0.75),
      0 0 55px 16px rgba(45, 130, 245, 0.45),
      0 0 120px 40px rgba(30, 100, 220, 0.25);
  }
  /* The globe sits on deep space, like the profile screen it replaces. */
  .maplibregl-ctrl-attrib { font-size: 9px; opacity: 0.6; }
  .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right { bottom: var(--bottom-padding); }
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
<div id="glow"></div>
<div id="map"></div>
<script src="${MAPLIBRE_JS}" integrity="${MAPLIBRE_JS_SRI}" crossorigin="anonymous"></script>
<script>
(function () {
  var ROUTE = ${routeLiteral};
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
    // NO style here, deliberately. The globe projection has to be part of the
    // style when that style is committed, or the first frames are drawn in
    // Mercator and only become a sphere afterwards — that is the flat world
    // map that used to flash on every launch. There is no way to say "globe"
    // up front: the constructor takes no transformStyle, and setProjection()
    // throws before the style has loaded. So the map starts style-less (it
    // draws nothing at all) and the style is committed below with the
    // projection already set on it.
    center: last,
    // Low enough that the whole sphere sits inside the visible band with space
    // around it, the way the globe reads on a profile screen. Anything past ~2
    // and the planet is cropped by the viewport.
    zoom: 0.9,
    attributionControl: { compact: true },
  });
  map.setStyle(STYLE_URL, {
    transformStyle: function (previous, next) {
      next.projection = { type: 'globe' };
      return next;
    },
  });
  // The sheet covers the lower part of the screen, so the globe is centred in
  // what is left above it. Set after construction: padding passed to the
  // constructor is ignored, which silently centres the globe behind the sheet.
  map.setPadding({ top: 0, left: 0, right: 0, bottom: BOTTOM_PADDING });
  map.on('error', function (e) {
    var err = e && e.error;
    // A tile request that was cancelled mid-flight reports as status 0. That
    // happens constantly and harmlessly while panning — MapLibre aborts tiles
    // it no longer needs — and reporting it buries the errors that matter.
    if (err && err.status === 0) return;
    post({ type: 'error', message: String((err && err.message) || 'map error') });
  });

  /**
   * Plane icon, drawn at runtime rather than shipped as an asset.
   *
   * NO pre-rotation. This used to rotate the glyph 45° on the belief that ✈
   * points north-east; it does not — measured against a horizontal line, the
   * glyph's nose already points EAST, which is the direction MapLibre rotates
   * a line-placed symbol towards. The correction was what tilted the plane off
   * its own leg.
   */
  function planeIcon() {
    var size = 64;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.translate(size / 2, size / 2);
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
    // MapLibre paints the compact attribution EXPANDED the first time, so the
    // ⓘ panel greeted the publisher on every launch. Shut it once, here.
    //
    // Collapsing, not removing: crediting MapTiler and OpenStreetMap is a
    // licence condition, so the ⓘ button stays and tapping it re-adds this
    // class and opens the panel as normal. CSS can't do this — the same class
    // marks "user opened it", so hiding it would break the button too.
    var attrib = document.querySelector('.maplibregl-ctrl-attrib');
    if (attrib) attrib.classList.remove('maplibregl-compact-show');

    // No setSky atmosphere here on purpose. MapLibre's atmosphere is lit from
    // the sun position, so it brightens ONE limb of the planet and leaves the
    // rest dark — not the even ring we want. The halo is drawn instead as a
    // circle behind the (transparent-outside-the-sphere) canvas, tracked to the
    // globe in positionGlow() below.

    var icon = planeIcon();
    if (!map.hasImage('plane')) {
      map.addImage('plane', { width: icon.width, height: icon.height, data: icon.data });
    }

    map.addSource('route', { type: 'geojson', data: routeFeatures() });

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

    addMarkers();

    positionGlow();
    map.on('move', positionGlow);
    map.on('zoom', positionGlow);
    map.on('resize', positionGlow);

    startDrift();

    loaded = true;
    // A route that arrived while the style was still loading — apply it now
    // rather than dropping it, or a fast feed load would leave a bare planet.
    if (pendingRoute) {
      applyRoute(pendingRoute);
      pendingRoute = null;
    }
    post({ type: 'ready' });
  });

  /** The legs, as the GeoJSON the 'route' source consumes. */
  function routeFeatures() {
    return {
      type: 'FeatureCollection',
      features: ROUTE.legs.map(function (leg) {
        return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: leg.path } };
      }),
    };
  }

  var markers = [];
  function addMarkers() {
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
      //
      // subpixelPositioning stops the wobble during a zoom: by default a marker
      // is snapped to whole pixels every frame, so while the map scales
      // continuously each one jumps a pixel back and forth against the imagery
      // underneath. Positioning on fractions lets them track the map exactly.
      var marker = new maplibregl.Marker({
        element: el,
        opacityWhenCovered: '0',
        subpixelPositioning: true,
      })
        .setLngLat(stop.position)
        .addTo(map);
      markers.push(marker);
    });
  }

  /**
   * Swaps in a new route without reloading the page.
   *
   * This is the whole point of the bridge below. The route changes constantly
   * — the feed is refetched on every focus, and deleting a post rewrites it —
   * and rebuilding the HTML for that would throw the document away: a fresh
   * MapLibre, a fresh style fetch, every tile and thumbnail downloaded again,
   * and the Mercator-to-globe boot visible each time. The source data and the
   * markers are the only things that actually differ, so only they are redone.
   */
  var loaded = false;
  var pendingRoute = null;
  function applyRoute(next) {
    var hadStops = ROUTE.stops.length > 0;
    ROUTE = next;
    map.getSource('route').setData(routeFeatures());
    markers.forEach(function (marker) { marker.remove(); });
    markers = [];
    addMarkers();
    // Only when the first stops arrive at all: the page is built before the
    // feed has loaded, so the camera is parked on a neutral view of the planet
    // and has to be told where the trip is. Never afterwards — the user may
    // have spun the globe somewhere, and deleting a post must not yank it back.
    if (!hadStops && ROUTE.stops.length > 0) {
      map.jumpTo({ center: ROUTE.stops[ROUTE.stops.length - 1].position });
    }
    positionGlow();
  }
  window.__setRoute = function (next) {
    if (!loaded) { pendingRoute = next; return; }
    applyRoute(next);
  };

  /** Re-centres the globe when the sheet over it changes height. */
  window.__setBottomPadding = function (px) {
    BOTTOM_PADDING = px;
    document.documentElement.style.setProperty('--bottom-padding', px + 'px');
    map.setPadding({ top: 0, left: 0, right: 0, bottom: px });
  };

  /**
   * Sizes the halo to the planet and pins it to the planet's centre.
   *
   * The radius is MEASURED, not derived from zoom. Deriving it from zoom is
   * wrong on a globe: the zoom value is the Mercator-equivalent scale at the
   * centre latitude, so panning north or south changes it while the planet's
   * on-screen size does not — the ring would swell and shrink around a planet
   * that never moved, leaving a black gap.
   *
   * Instead: any point exactly 90 degrees of arc from the centre lies on the
   * silhouette, whatever the projection is doing. For a centre at (lng, lat),
   * (lng + 90, 0) is always exactly 90 degrees away — the spherical law of
   * cosines collapses to cos(d) = 0 for any latitude. So the distance on
   * screen from the centre to that point IS the planet's radius.
   */
  var glow = document.getElementById('glow');
  function positionGlow() {
    var c = map.getCenter();
    var centre = map.project(c);
    var limb = map.project([c.lng + 90, 0]);
    var radius = Math.hypot(limb.x - centre.x, limb.y - centre.y);
    if (!isFinite(radius) || radius <= 0) return;

    glow.style.width = radius * 2 + 'px';
    glow.style.height = radius * 2 + 'px';
    glow.style.left = centre.x + 'px';
    glow.style.top = centre.y + 'px';
    // Once the planet is far larger than the screen there is no visible limb
    // to glow, and a huge off-screen ring is just wasted paint.
    var fits = radius * 2 < Math.max(window.innerWidth, window.innerHeight) * 1.8;
    glow.style.opacity = fits ? '1' : '0';
  }

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
