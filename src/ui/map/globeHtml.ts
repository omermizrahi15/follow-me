import {
  GLOBE_CLIENT_JS,
  GLOBE_CSS,
  MAPLIBRE_CSS,
  MAPLIBRE_CSS_SRI,
  MAPLIBRE_JS,
  MAPLIBRE_JS_SRI,
} from './globeClient';

// The globe's rendering code is shared with the follower website and lives in
// globeClient.ts; this file only wraps it in the WebView document.
export { MAPLIBRE_VERSION } from './globeClient';

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
  html, body { margin: 0; padding: 0; height: 100%; width: 100%; background: #05070f; }
${GLOBE_CSS}
</style>
</head>
<body>
<div class="globe-stage" id="stage"><div class="globe-glow"></div><div class="globe-map"></div></div>
<script src="${MAPLIBRE_JS}" integrity="${MAPLIBRE_JS_SRI}" crossorigin="anonymous"></script>
<script>
${GLOBE_CLIENT_JS}
(function () {
  function post(message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  window.onerror = function (message) { post({ type: 'error', message: String(message) }); };
  var globe = window.createRouteGlobe({
    root: document.getElementById('stage'),
    route: ${routeLiteral},
    styleUrl: ${toScriptLiteral(styleUrl)},
    bottomPadding: ${Math.round(bottomPadding)},
    post: post,
  });
  // The two things React Native pushes into the running page: a new route, and
  // a new sheet height. Neither reloads the document.
  window.__setRoute = globe.setRoute;
  window.__setBottomPadding = globe.setBottomPadding;
}());
</script>
</body>
</html>`;
}
