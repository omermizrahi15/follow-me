import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * E2E for the public post gallery (docs/gallery.html) — what a follower sees
 * when they tap the link in the WhatsApp message. The page reads Supabase REST
 * with the anon key; we intercept those calls so the tests are deterministic
 * and touch no real data.
 *
 * The behaviour under test is the two-view flow: opening a post plays it as a
 * story (no thumbnail grid), and going back lands on the publisher's feed.
 */

const PUBLISHER = 'pub-1';

const POSTS = [
  {
    id: 'post-newest',
    publisher_id: PUBLISHER,
    place: 'Lisbon, Portugal',
    created_at: '2026-06-18T10:00:00.000Z',
    media_urls: ['https://img.test/a1.jpg', 'https://img.test/a2.jpg', 'https://img.test/a3.jpg'],
  },
  {
    id: 'post-linked',
    publisher_id: PUBLISHER,
    place: 'Porto, Portugal',
    created_at: '2026-05-02T10:00:00.000Z',
    media_urls: ['https://img.test/b1.jpg', 'https://img.test/b2.jpg'],
  },
  // No place — the card falls back to the date alone, like the app's PostCard.
  {
    id: 'post-oldest',
    publisher_id: PUBLISHER,
    place: null,
    created_at: '2026-01-09T10:00:00.000Z',
    media_urls: ['https://img.test/c1.jpg'],
  },
];

const PROFILE = [{ display_name: 'Omer', avatar_url: null }];

/** A 1x1 PNG, so photo requests resolve instead of hanging on a fake host. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function mockSupabase(page: Page, posts = POSTS): Promise<void> {
  await page.route('**/rest/v1/posts*', route => {
    const query = new URL(route.request().url()).search;
    const byId = /[?&]id=eq\.([^&]+)/.exec(query);
    if (byId != null) {
      const post = posts.find(p => p.id === decodeURIComponent(byId[1]!));
      return json(route, post != null ? [post] : []);
    }
    // Publisher listing — the page asks for newest-first; serve it that way.
    return json(route, [...posts].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  });
  await page.route('**/rest/v1/publisher_profile*', route => json(route, PROFILE));
  await page.route('https://img.test/**', route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  );
}

const feed = (page: Page) => page.locator('#feedView');
const story = (page: Page) => page.locator('#story');
const cards = (page: Page) => page.locator('.card');

test.describe('post gallery', () => {
  test('the shared link plays its post as a story straight away', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html?id=post-linked');

    await expect(story(page)).toBeVisible();
    await expect(feed(page)).toBeHidden();
    await expect(page.locator('#storyPlace')).toHaveText('Porto, Portugal');
    // First photo of two — no grid to pick from.
    await expect(page.locator('#storyMeta')).toHaveText('May 2, 2026 · 1/2');
    await expect(page.locator('#storyImage')).toHaveAttribute('src', 'https://img.test/b1.jpg');
    await expect(page.locator('#storySegments span')).toHaveCount(2);
  });

  test('tapping advances through the photos, then leaves for the feed', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html?id=post-linked');
    await expect(story(page)).toBeVisible();

    await story(page).click({ position: { x: 600, y: 400 } });
    await expect(page.locator('#storyMeta')).toHaveText('May 2, 2026 · 2/2');

    // Past the last photo — the story ends on the feed, not a dead end.
    await story(page).click({ position: { x: 600, y: 400 } });
    await expect(story(page)).toBeHidden();
    await expect(feed(page)).toBeVisible();
  });

  test('going back from the linked post lists every post, newest first', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html?id=post-linked');
    await expect(story(page)).toBeVisible();

    await page.goBack();

    await expect(feed(page)).toBeVisible();
    await expect(story(page)).toBeHidden();
    await expect(page.locator('#feedName')).toHaveText('Omer');
    await expect(page.locator('#feedCount')).toHaveText('3 posts');
    await expect(cards(page)).toHaveCount(3);
    await expect(cards(page).nth(0)).toContainText('Lisbon, Portugal');
    await expect(cards(page).nth(1)).toContainText('Porto, Portugal');
    // No place on the oldest post — the date carries the card on its own.
    await expect(cards(page).nth(2)).toContainText('January 9, 2026');
  });

  test('a card plays its own post from the first photo', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html?id=post-linked');
    await expect(story(page)).toBeVisible();
    await page.goBack();
    await cards(page).nth(0).click();

    await expect(story(page)).toBeVisible();
    await expect(page.locator('#storyPlace')).toHaveText('Lisbon, Portugal');
    await expect(page.locator('#storyMeta')).toHaveText('June 18, 2026 · 1/3');
    await expect(page.locator('#storyImage')).toHaveAttribute('src', 'https://img.test/a1.jpg');
    await expect(page).toHaveURL(/\?id=post-newest$/);

    await page.goBack();
    await expect(feed(page)).toBeVisible();
    await expect(story(page)).toBeHidden();
  });

  test('the feed link renders the feed directly', async ({ page }) => {
    await mockSupabase(page);
    await page.goto(`/gallery.html?u=${PUBLISHER}`);

    await expect(feed(page)).toBeVisible();
    await expect(cards(page)).toHaveCount(3);
  });

  test('the photo count chip only shows on multi-photo posts', async ({ page }) => {
    await mockSupabase(page);
    await page.goto(`/gallery.html?u=${PUBLISHER}`);

    await expect(cards(page).nth(0).locator('.card-chip')).toHaveText(/3/);
    await expect(cards(page).nth(2).locator('.card-chip')).toHaveCount(0);
  });

  // The cover image is decorative, so the card would otherwise be a button
  // with no accessible name at all.
  test('each card announces its post', async ({ page }) => {
    await mockSupabase(page);
    await page.goto(`/gallery.html?u=${PUBLISHER}`);

    await expect(
      page.getByRole('button', { name: 'Lisbon, Portugal, June 18, 2026 — 3 photos' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'January 9, 2026 — 1 photo' })).toBeVisible();
  });

  test('advancing deep into a story still costs one back to leave', async ({ page }) => {
    await mockSupabase(page);
    await page.goto(`/gallery.html?u=${PUBLISHER}`);
    await cards(page).nth(0).click();
    await story(page).click({ position: { x: 600, y: 400 } });
    await expect(page.locator('#storyMeta')).toHaveText('June 18, 2026 · 2/3');

    await page.goBack();

    await expect(story(page)).toBeHidden();
    await expect(feed(page)).toBeVisible();
  });

  test('closing the story with ✕ lands on the feed', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html?id=post-linked');
    await expect(story(page)).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    await expect(story(page)).toBeHidden();
    await expect(feed(page)).toBeVisible();
    await expect(cards(page)).toHaveCount(3);
  });

  test('an unknown post id shows a friendly error', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html?id=nope');

    await expect(page.locator('#status')).toHaveText('This post was not found or has expired.');
    await expect(story(page)).toBeHidden();
    await expect(feed(page)).toBeHidden();
  });

  test('a link with no id and no publisher is rejected', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html');

    await expect(page.locator('#status')).toHaveText('This link is invalid.');
  });
});
