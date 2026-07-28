import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * E2E for the public post gallery (docs/gallery.html) — what a follower sees
 * when they tap the link in the WhatsApp message. The page reads Supabase REST
 * with the anon key; we intercept those calls so the tests are deterministic
 * and touch no real data.
 *
 * The behaviour under test is the two-view flow: the link opens its own post,
 * and going back lands on the publisher's whole feed.
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
const post = (page: Page) => page.locator('#postView');
const cards = (page: Page) => page.locator('.card');

test.describe('post gallery', () => {
  test('the shared link opens the post it points at', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html?id=post-linked');

    await expect(post(page)).toBeVisible();
    await expect(feed(page)).toBeHidden();
    await expect(page.locator('#title')).toHaveText('Porto, Portugal');
    await expect(page.locator('#subtitle')).toHaveText('2 photos · May 2, 2026');
    await expect(page.locator('.grid button')).toHaveCount(2);
  });

  test('going back from the linked post lists every post, newest first', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html?id=post-linked');
    await expect(post(page)).toBeVisible();

    await page.goBack();

    await expect(feed(page)).toBeVisible();
    await expect(post(page)).toBeHidden();
    await expect(page.locator('#feedName')).toHaveText('Omer');
    await expect(page.locator('#feedCount')).toHaveText('3 posts');
    await expect(cards(page)).toHaveCount(3);
    await expect(cards(page).nth(0)).toContainText('Lisbon, Portugal');
    await expect(cards(page).nth(1)).toContainText('Porto, Portugal');
    // No place on the oldest post — the date carries the card on its own.
    await expect(cards(page).nth(2)).toContainText('January 9, 2026');
  });

  test('the in-page back button reaches the feed too', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html?id=post-linked');
    await page.getByRole('button', { name: 'All posts' }).click();

    await expect(feed(page)).toBeVisible();
    await expect(page).toHaveURL(/\?u=pub-1$/);
  });

  test('a card opens its own post, and back returns to the feed', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html?id=post-linked');
    await expect(post(page)).toBeVisible();
    await page.goBack();
    await cards(page).nth(0).click();

    await expect(post(page)).toBeVisible();
    await expect(page.locator('#title')).toHaveText('Lisbon, Portugal');
    await expect(page.locator('.grid button')).toHaveCount(3);
    await expect(page).toHaveURL(/\?id=post-newest$/);

    await page.goBack();
    await expect(feed(page)).toBeVisible();
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

  test('back from a photo returns to the post, not the feed', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html?id=post-linked');
    await page.locator('.grid button').first().click();
    await expect(page.locator('#story')).toBeVisible();

    await page.goBack();

    await expect(page.locator('#story')).toBeHidden();
    await expect(post(page)).toBeVisible();
    await expect(feed(page)).toBeHidden();
  });

  test('closing the story with ✕ leaves the post shown', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html?id=post-linked');
    await page.locator('.grid button').first().click();
    await page.getByRole('button', { name: 'Close' }).click();

    await expect(page.locator('#story')).toBeHidden();
    await expect(post(page)).toBeVisible();
  });

  test('an unknown post id shows a friendly error', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html?id=nope');

    await expect(page.locator('#status')).toHaveText('This post was not found or has expired.');
    await expect(post(page)).toBeHidden();
    await expect(feed(page)).toBeHidden();
  });

  test('a link with no id and no publisher is rejected', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/gallery.html');

    await expect(page.locator('#status')).toHaveText('This link is invalid.');
  });
});
