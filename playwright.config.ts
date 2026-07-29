import { defineConfig, devices } from '@playwright/test';

/**
 * Web E2E for the public follower-facing pages — the subscribe page
 * (docs/join/index.html) and the post gallery (docs/gallery.html) — which the
 * app itself can't cover: they're static pages a follower opens in a browser.
 * Runs headless on Ubuntu in ~1 min (no simulator), separate from the Maestro
 * app suite. See docs/E2E.md.
 */
export default defineConfig({
  testDir: './web-e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Serve docs/ so /join/ resolves exactly as it does on GitHub Pages.
  webServer: {
    command: 'python3 -m http.server 8080 --directory docs',
    url: 'http://localhost:8080/join/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
