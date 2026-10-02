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

/** The page opens on the posts; the map loads when asked for. */
const reveal = (page: Page) => page.locator('#mapPill').click();
const hero = (page: Page) => page.locator('#globeHero');
const markers = (page: Page) => page.locator('#globeStage .stop');

test.describe('travel globe', () => {
  test.describe('teaser (before the map is asked for)', () => {
    test('opens on the posts, with the planet only peeking and no map loaded', async ({ page }) => {
      const requested: string[] = [];
      page.on('request', r => requested.push(r.url()));
      await mock(page, [LISBON, PORTO, NO_GPS]);
      await page.goto(`/gallery.html?u=${PUBLISHER}`);
      await expect(page.locator('.card')).toHaveCount(3);

      const h = page.viewportSize()!.height;
      const visible = await page.evaluate(() => window.innerHeight - document.getElementById('sheet')!.getBoundingClientRect().top);
      expect(Math.abs(visible - Math.round(h * 0.84))).toBeLessThan(3);
      await expect(page.locator('#planetPeek')).toBeVisible();
      await expect(page.locator('#mapPill')).toHaveText('See 2 places on the map');
      // Nothing for the map has been fetched: no library, no style, no tiles.
      await page.waitForTimeout(500);
      expect(requested.filter(u => /unpkg|maplibre|maptiler/.test(u))).toEqual([]);
    });

    test('the pill opens the map and then gets out of the way', async ({ page }) => {
      await mock(page, [LISBON, PORTO]);
      await page.goto(`/gallery.html?u=${PUBLISHER}`);
      await expect(page.locator('#mapPill')).toBeVisible();

      await reveal(page);

      await expect(markers(page)).toHaveCount(2);
      await expect(page.locator('#globeHero')).toHaveClass(/ready/);
      await expect(page.locator('#mapPill')).toBeHidden();
    });

    test('dragging the sheet down also loads the map', async ({ page }) => {
      await mock(page, [LISBON]);
      await page.goto(`/gallery.html?u=${PUBLISHER}`);
      await expect(page.locator('.card')).toHaveCount(1);
      const box = (await page.locator('#sheetHandle').boundingBox())!;
      const x = box.x + box.width / 2;
      await page.mouse.move(x, box.y + 10);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(x, box.y + 10 + i * 20); await page.waitForTimeout(40); }
      await page.waitForTimeout(250);
      await page.mouse.up();

      await expect(markers(page)).toHaveCount(1);
    });
  });

  test('the feed opens on the globe, with one photo marker per located post', async ({ page }) => {
    await mock(page, [LISBON, PORTO, NO_GPS]);
    await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await reveal(page);

    await expect(hero(page)).toBeVisible();
    // The post without GPS is on the feed but not on the map.
    await expect(markers(page)).toHaveCount(2);
    await expect(page.locator('.card')).toHaveCount(3);
    await expect(page.locator('#globeStage canvas')).toBeVisible();
  });

  test('markers are named for their place and carry the cover photo', async ({ page }) => {
    await mock(page, [LISBON, PORTO]);
    await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await reveal(page);

    await expect(page.getByRole('button', { name: 'Lisbon, Portugal', exact: true }).first()).toBeAttached();
    await expect(markers(page).first().locator('img')).toHaveAttribute('src', /img\.test\/post-/);
  });

  test('tapping a marker plays that post as a story, and back returns to the globe', async ({ page }) => {
    await mock(page, [LISBON, PORTO]);
    await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await reveal(page);
    await expect(markers(page)).toHaveCount(2);

    await page.getByRole('button', { name: 'Porto, Portugal', exact: true }).first().dispatchEvent('click');

    await expect(page.locator('#story')).toBeVisible();
    await expect(page.locator('#storyPlace')).toHaveText('Porto, Portugal');
    await expect(page).toHaveURL(/\?id=post-porto$/);

    await page.goBack();
    await expect(page.locator('#story')).toBeHidden();
    await expect(hero(page)).toBeVisible();
  });

  test('with no located posts it is still the planet, as in the app', async ({ page }) => {
    await mock(page, [NO_GPS]);
    await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await reveal(page);

    await expect(page.locator('.card')).toHaveCount(1);
    await expect(hero(page)).toBeVisible();
    await expect(page.locator('#globeStage canvas')).toBeVisible();
    await expect(markers(page)).toHaveCount(0);
  });

  test('a deep-linked post still shows the globe once the feed is reached', async ({ page }) => {
    await mock(page, [LISBON, PORTO]);
    await page.goto('/gallery.html?id=post-lisbon');
    await expect(page.locator('#story')).toBeVisible();

    await page.goBack();
    await reveal(page);

    await expect(hero(page)).toBeVisible();
    await expect(markers(page)).toHaveCount(2);
  });

  test('the feed survives the map library failing to load', async ({ page }) => {
    await mock(page, [LISBON]);
    await page.route('https://unpkg.com/**', route => route.abort());
    await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await reveal(page);

    await expect(page.locator('.card')).toHaveCount(1);
    await expect(hero(page)).toBeHidden();
    await expect(page.locator('body')).toHaveClass(/no-globe/);
  });

  // Over the map provider's quota: no globe, but a page that still looks finished.
  test.describe('without the globe (map provider refuses)', () => {
    async function expectPlainFeed(page: Page): Promise<void> {
      await expect(page.locator('body')).toHaveClass(/no-globe/);
      await expect(hero(page)).toBeHidden();
      await expect(page.locator('#sheetHandle')).toBeHidden();
      await expect(page.locator('#feedName')).toHaveText('Omer');
      // Cards are in normal flow: the first is on screen with no dragging.
      const first = page.locator('.card').first();
      await expect(first).toBeInViewport();
      // And the page scrolls like a page, not a sheet.
      expect(await page.evaluate(() => getComputedStyle(document.getElementById('sheet')!).position)).toBe('static');
    }

    test('an over-quota style request leaves the plain feed', async ({ page }) => {
      await mock(page, [LISBON, PORTO]);
      await page.route(/demotiles\.maplibre\.org|api\.maptiler\.com\/maps/, route =>
        route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"quota"}' }),
      );
      await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await reveal(page);

      await expect(page.locator('.card')).toHaveCount(2);
      await expectPlainFeed(page);
      await expect(page.locator('script[src*="maplibre"]')).toHaveCount(0);
    });

    test('tiles that run out of quota mid-visit drop the globe', async ({ page }) => {
      await mock(page, [LISBON, PORTO]);
      await page.route(/demotiles\.maplibre\.org|api\.maptiler\.com\/maps/, route =>
        json(route, {
          version: 8,
          sources: { t: { type: 'raster', tiles: ['https://tiles.test/{z}/{x}/{y}.png'], tileSize: 256 } },
          layers: [{ id: 'r', type: 'raster', source: 't' }],
        }),
      );
      await page.route('https://tiles.test/**', route => route.fulfill({ status: 429, body: 'quota' }));
      await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await reveal(page);

      await expect(page.locator('body')).toHaveClass(/no-globe/);
      await expectPlainFeed(page);
    });

    test('a story still opens from a card without the globe', async ({ page }) => {
      await mock(page, [LISBON]);
      await page.route(/demotiles\.maplibre\.org|api\.maptiler\.com\/maps/, route => route.fulfill({ status: 429, body: '' }));
      await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await reveal(page);
      await page.locator('.card').first().click();

      await expect(page.locator('#story')).toBeVisible();
      await page.goBack();
      await expect(page.locator('.card').first()).toBeInViewport();
    });
  });

  test('the map library is the pinned build with its integrity hash', async ({ page }) => {
    await mock(page, [LISBON]);
    await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await reveal(page);
    await expect(markers(page)).toHaveCount(1);

    const script = page.locator('script[src*="maplibre-gl"]');
    await expect(script).toHaveAttribute('src', /maplibre-gl@5\.\d+\.\d+\//);
    await expect(script).toHaveAttribute('integrity', /^sha384-/);
  });

  // The draggable Me sheet (HomeScreen): rests at 42% of the screen, drags to
  // a peek (20%) or near-full (84%).
  test.describe('draggable sheet', () => {
    // Lets the sheet's settle animation (~320 ms) finish before measuring.
    const visibleHeight = async (page: Page) => {
      await page.waitForTimeout(450);
      return page.evaluate(() => window.innerHeight - document.getElementById('sheet')!.getBoundingClientRect().top);
    };

    async function drag(page: Page, dy: number): Promise<void> {
      const box = (await page.locator('#sheetHandle').boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      // Slow steps: the release must read as a drag, not a flick.
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(x, y + (dy * i) / 10);
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(250);
      await page.mouse.up();
      await page.waitForTimeout(500);
    }

    test('rests at the Me-page height', async ({ page }) => {
      await mock(page, [LISBON]);
      await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await reveal(page);
      await expect(page.locator('.card')).toHaveCount(1);
      const h = page.viewportSize()!.height;
      expect(Math.abs((await visibleHeight(page)) - Math.round(h * 0.42))).toBeLessThan(3);
    });

    test('dragging up opens it nearly full, dragging down parks it as a peek', async ({ page }) => {
      await mock(page, [LISBON]);
      await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await reveal(page);
      const h = page.viewportSize()!.height;

      await drag(page, -(h * 0.5));
      expect(Math.abs((await visibleHeight(page)) - Math.round(h * 0.84))).toBeLessThan(3);

      await drag(page, h * 0.8);
      expect(Math.abs((await visibleHeight(page)) - Math.round(h * 0.2))).toBeLessThan(3);
    });

    test('the last post can be scrolled fully into view, whatever height the sheet rests at', async ({ page }) => {
      // The sheet hangs off the bottom of the screen, so without padding the
      // end of the list is laid out below the viewport and can never be reached.
      const many = Array.from({ length: 8 }, (_, i) =>
        post(`p${i}`, `2026-0${i + 1}-10T10:00:00.000Z`, `Place ${i}`, [10 + i, 20 + i]),
      );
      await mock(page, many);
      await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await reveal(page);
      await expect(page.locator('.card')).toHaveCount(8);

      await page.locator('#sheetBody').evaluate(el => { el.scrollTop = el.scrollHeight; });
      const bottom = await page.locator('.card').last().evaluate(el => el.getBoundingClientRect().bottom);
      expect(bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
    });

    test('the arrow keys move the sheet between its snap heights', async ({ page }) => {
      await mock(page, [LISBON]);
      await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await reveal(page);
      await expect(page.locator('.card')).toHaveCount(1);
      const h = page.viewportSize()!.height;

      await page.locator('#sheetHandle').focus();
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(500);
      expect(Math.abs((await visibleHeight(page)) - Math.round(h * 0.84))).toBeLessThan(3);
      await expect(page.locator('#sheetHandle')).toHaveAttribute('aria-valuetext', 'Fully open');

      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(500);
      expect(Math.abs((await visibleHeight(page)) - Math.round(h * 0.2))).toBeLessThan(3);
    });

    test('the globe keeps its place behind the sheet', async ({ page }) => {
      await mock(page, [LISBON]);
      await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await reveal(page);
      await expect(markers(page)).toHaveCount(1);
      const box = (await hero(page).boundingBox())!;
      // Full-bleed behind the sheet, not a card above it.
      expect(box.height).toBe(page.viewportSize()!.height);
    });
  });
});
