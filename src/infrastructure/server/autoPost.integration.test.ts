/**
 * Integration smoke test for the deployed `auto-post` Edge Function — run with
 * `npm run test:integration`. Verifies the cron-secret guard and that a properly
 * authorized call runs and returns a results map. Deep delivery assertions (real
 * WhatsApp to a test number, `media` rows) are exercised manually against seeded
 * test data — see the plan's manual e2e steps.
 *
 * Activate:
 *   export AUTO_POST_FN_URL="https://<project>.functions.supabase.co/auto-post"
 *   export CRON_SECRET="<the function's CRON_SECRET>"
 *   npm run test:integration
 *
 * Auto-skips when the env vars are absent so CI stays green.
 */
const FN_URL = process.env['AUTO_POST_FN_URL'] as string | undefined;
const CRON_SECRET = process.env['CRON_SECRET'] as string | undefined;
const ENABLED = Boolean(FN_URL && CRON_SECRET);

const describeMaybe = ENABLED ? describe : describe.skip;

if (!ENABLED) {
  // eslint-disable-next-line no-console
  console.warn('[auto-post.integration] skipped — set AUTO_POST_FN_URL and CRON_SECRET to activate.');
}

describeMaybe('auto-post Edge Function (integration)', () => {
  jest.setTimeout(60_000);

  it('rejects calls without the cron secret', async () => {
    const res = await fetch(FN_URL!, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
  });

  it('runs and returns a results map when authorized', async () => {
    const res = await fetch(FN_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET! },
      body: '{}',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ran_at?: string; results?: Record<string, string> };
    expect(typeof body.ran_at).toBe('string');
    expect(body.results).toBeDefined();
    // eslint-disable-next-line no-console
    console.log('[auto-post.integration] results:', body.results);
  });
});
