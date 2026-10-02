/**
 * The follower website's globe (docs/globe/*) is generated from the app's
 * sources by scripts/build-web-globe.js. This fails when someone edits the
 * globe and forgets to regenerate, which would silently ship the website a
 * different globe from the app's.
 */
import fs from 'fs';
import path from 'path';
import { buildGlobeHtml } from './ui/map/globeHtml';
import { GLOBE_CLIENT_JS, GLOBE_CSS, MAPLIBRE_JS_SRI } from './ui/map/globeClient';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generate, OUT_DIR } = require('../scripts/build-web-globe.js') as {
  generate: () => Record<string, string>;
  OUT_DIR: string;
};

describe('web globe', () => {
  const generated = generate();

  it.each(Object.keys(generated))('docs/globe/%s is up to date', name => {
    const onDisk = fs.readFileSync(path.join(OUT_DIR, name), 'utf8');
    expect(onDisk).toBe(generated[name]);
  });

  it('shares its rendering code with the app', () => {
    const html = buildGlobeHtml({
      routeLiteral: '{"stops":[],"legs":[]}',
      styleUrl: 'https://s/style.json',
      bottomPadding: 120,
    });
    expect(html).toContain(GLOBE_CLIENT_JS);
    expect(html).toContain(GLOBE_CSS);
    expect(generated['globe.js']).toContain(GLOBE_CLIENT_JS.trimStart());
  });

  it('pins the same MapLibre build, integrity hash included, on the web', () => {
    expect(generated['globe.js']).toContain(MAPLIBRE_JS_SRI);
  });

  it('ships the route geometry as a plain ES module', () => {
    expect(generated['travelRoute.js']).toMatch(/export function buildTravelRoute/);
    expect(generated['travelRoute.js']).not.toMatch(/\bimport\b/);
  });
});
