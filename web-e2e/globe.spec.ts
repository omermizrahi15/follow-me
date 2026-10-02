import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * E2E for the travel globe on the follower gallery (issue #200). The globe is
 * the app's own MapLibre GL JS renderer (docs/globe/, generated from the app's
 * sources); these tests check the page wires it up the way the app does:
 * located posts become photo markers, a marker opens that post's story, and a
 * feed with nothing to plot shows no globe at all.
 *
 * Supabase and the map style are mocked so nothing depends on real data or on
 * a tile provider; the pinned MapLibre build itself is fetched from its CDN,
 * with its integrity hash enforced, exactly as a follower's browser does.
 */

const PUBLISHER = 'pub-1';

const post = (id: string, created_at: string, place: string | null, coords: [number, number] | null) => ({
  id,
  publisher_id: PUBLISHER,
  place,
  created_at,
  latitude: coords?.[0] ?? null,
  longitude: coords?.[1] ?? null,
  media_urls: [`https://img.test/${id}-1.jpg`, `https://img.test/${id}-2.jpg`],
});

const LISBON = post('post-lisbon', '2026-06-18T10:00:00.000Z', 'Lisbon, Portugal', [38.72, -9.14]);
const PORTO = post('post-porto', '2026-05-02T10:00:00.000Z', 'Porto, Portugal', [41.15, -8.61]);
const NO_GPS = post('post-nogps', '2026-01-09T10:00:00.000Z', null, null);

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** A style with no sources: the globe draws a plain sphere, no tile requests. */
const BLANK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#1b4965' } }],
};

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function mock(page: Page, posts: unknown[]): Promise<void> {
  await page.route('**/rest/v1/posts*', route => {
    const byId = /[?&]id=eq\.([^&]+)/.exec(new URL(route.request().url()).search);
    if (byId != null) {
      const found = (posts as { id: string }[]).find(p => p.id === decodeURIComponent(byId[1]!));
      return json(route, found != null ? [found] : []);
    }
    return json(route, posts);
  });
  await page.route('**/rest/v1/publisher_profile*', route =>
    json(route, [{ display_name: 'Omer', avatar_url: null }]),
  );
  await page.route(/demotiles\.maplibre\.org|api\.maptiler\.com\/maps/, route => json(route, BLANK_STYLE));
  await page.route('https://img.test/**', route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  );
}

const hero = (page: Page) => page.locator('#globeHero');
const markers = (page: Page) => page.locator('#globeStage .stop');

test.describe('travel globe', () => {
  test('the feed opens on the globe, with one photo marker per located post', async ({ page }) => {
    await mock(page, [LISBON, PORTO, NO_GPS]);
    await page.goto(`/gallery.html?u=${PUBLISHER}`);

    await expect(hero(page)).toBeVisible();
    // The post without GPS is on the feed but not on the map.
    await expect(markers(page)).toHaveCount(2);
    await expect(page.locator('.card')).toHaveCount(3);
    await expect(page.locator('#globeStage canvas')).toBeVisible();
  });

  test('markers are named for their place and carry the cover photo', async ({ page }) => {
    await mock(page, [LISBON, PORTO]);
    await page.goto(`/gallery.html?u=${PUBLISHER}`);

    await expect(page.getByRole('button', { name: 'Lisbon, Portugal', exact: true }).first()).toBeAttached();
    await expect(markers(page).first().locator('img')).toHaveAttribute('src', /img\.test\/post-/);
  });

  test('tapping a marker plays that post as a story, and back returns to the globe', async ({ page }) => {
    await mock(page, [LISBON, PORTO]);
    await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await expect(markers(page)).toHaveCount(2);

    await page.getByRole('button', { name: 'Porto, Portugal', exact: true }).first().dispatchEvent('click');

    await expect(page.locator('#story')).toBeVisible();
    await expect(page.locator('#storyPlace')).toHaveText('Porto, Portugal');
    await expect(page).toHaveURL(/\?id=post-porto$/);

    await page.goBack();
    await expect(page.locator('#story')).toBeHidden();
    await expect(hero(page)).toBeVisible();
  });

  test('no globe when none of the posts has a location', async ({ page }) => {
    await mock(page, [NO_GPS]);
    await page.goto(`/gallery.html?u=${PUBLISHER}`);

    await expect(page.locator('.card')).toHaveCount(1);
    await expect(hero(page)).toBeHidden();
    await expect(page.locator('script[src*="maplibre"]')).toHaveCount(0);
  });

  test('a deep-linked post still shows the globe once the feed is reached', async ({ page }) => {
    await mock(page, [LISBON, PORTO]);
    await page.goto('/gallery.html?id=post-lisbon');
    await expect(page.locator('#story')).toBeVisible();

    await page.goBack();

    await expect(hero(page)).toBeVisible();
    await expect(markers(page)).toHaveCount(2);
  });

  test('the feed survives the map library failing to load', async ({ page }) => {
    await mock(page, [LISBON]);
    await page.route('https://unpkg.com/**', route => route.abort());
    await page.goto(`/gallery.html?u=${PUBLISHER}`);

    await expect(page.locator('.card')).toHaveCount(1);
    await expect(hero(page)).toBeHidden();
  });

  test('the map library is the pinned build with its integrity hash', async ({ page }) => {
    await mock(page, [LISBON]);
    await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await expect(markers(page)).toHaveCount(1);

    const script = page.locator('script[src*="maplibre-gl"]');
    await expect(script).toHaveAttribute('src', /maplibre-gl@5\.\d+\.\d+\//);
    await expect(script).toHaveAttribute('integrity', /^sha384-/);
  });
});
