import { test, expect, type Route } from '@playwright/test';

/**
 * E2E for the public subscribe page (docs/join/index.html) — the follower's
 * entry point. The page POSTs to the Supabase `subscribe` edge function; we
 * intercept that call so the tests are deterministic and create no real
 * subscriptions. The join URL carries the publisher id as `?p=`.
 */

const JOIN = '/join/?p=test-publisher-123';
// Glob so the test keeps matching if the function's base URL changes.
const SUBSCRIBE = '**/functions/v1/subscribe';

const fulfillJson = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test.describe('subscribe page', () => {
  test('renders the subscribe form', async ({ page }) => {
    await page.goto(JOIN);
    await expect(page.getByRole('heading', { name: 'Follow along on WhatsApp' })).toBeVisible();
    await expect(page.locator('#phone')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Subscribe' })).toBeVisible();
  });

  test('successful subscribe shows the confirmation with the number', async ({ page }) => {
    await page.route(SUBSCRIBE, route => fulfillJson(route, 200, { ok: true }));
    await page.goto(JOIN);
    await page.fill('#phone', '+972501234567');
    await page.getByRole('button', { name: 'Subscribe' }).click();

    await expect(page.getByRole('heading', { name: "You're subscribed!" })).toBeVisible();
    await expect(page.locator('#confirmed')).toHaveText('+972501234567');
    await expect(page.locator('#form-view')).toBeHidden();
  });

  test('sends the publisher id and phone to the subscribe function', async ({ page }) => {
    let payload: unknown = null;
    await page.route(SUBSCRIBE, route => {
      payload = route.request().postDataJSON();
      return fulfillJson(route, 200, { ok: true });
    });
    await page.goto(JOIN);
    await page.fill('#phone', '+972501234567');
    await page.getByRole('button', { name: 'Subscribe' }).click();

    await expect(page.getByRole('heading', { name: "You're subscribed!" })).toBeVisible();
    expect(payload).toEqual({ publisherId: 'test-publisher-123', contactHandle: '+972501234567' });
  });

  test('shows the server-provided error and keeps the form', async ({ page }) => {
    await page.route(SUBSCRIBE, route =>
      fulfillJson(route, 400, { ok: false, error: 'That number is already subscribed.' }),
    );
    await page.goto(JOIN);
    await page.fill('#phone', '+972501234567');
    await page.getByRole('button', { name: 'Subscribe' }).click();

    await expect(page.locator('#error')).toHaveText('That number is already subscribed.');
    await expect(page.locator('#form-view')).toBeVisible();
  });

  test('shows a network error when the request fails', async ({ page }) => {
    await page.route(SUBSCRIBE, route => route.abort('failed'));
    await page.goto(JOIN);
    await page.fill('#phone', '+972501234567');
    await page.getByRole('button', { name: 'Subscribe' }).click();

    await expect(page.locator('#error')).toHaveText('Network error. Please try again.');
  });

  // Staging publishers only exist in the staging Supabase project — links from
  // the staging app carry ?env=staging and must hit that project's function.
  test('routes to the staging function when the link carries env=staging', async ({ page }) => {
    let calledHost = '';
    await page.route(SUBSCRIBE, route => {
      calledHost = new URL(route.request().url()).host;
      return fulfillJson(route, 200, { ok: true });
    });
    await page.goto(`${JOIN}&env=staging`);
    await page.fill('#phone', '+972501234567');
    await page.getByRole('button', { name: 'Subscribe' }).click();

    await expect(page.getByRole('heading', { name: "You're subscribed!" })).toBeVisible();
    expect(calledHost).toBe('xszvrvnxduwpymyabvcg.supabase.co');
  });

  test('defaults to the production function without env (and for unknown env values)', async ({ page }) => {
    let calledHost = '';
    await page.route(SUBSCRIBE, route => {
      calledHost = new URL(route.request().url()).host;
      return fulfillJson(route, 200, { ok: true });
    });
    await page.goto(`${JOIN}&env=bogus`);
    await page.fill('#phone', '+972501234567');
    await page.getByRole('button', { name: 'Subscribe' }).click();

    await expect(page.getByRole('heading', { name: "You're subscribed!" })).toBeVisible();
    expect(calledHost).toBe('eigvoazyrimzbzcjlscp.supabase.co');
  });
});
