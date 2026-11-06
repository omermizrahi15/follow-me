/**
 * Supabase Edge Function: POST /revenuecat-webhook
 *
 * RevenueCat → `subscriptions` (issue #252). RevenueCat POSTs one event per
 * purchase/renewal/cancellation/expiry/billing problem; the pure decision of
 * what each means lives in src/domain/services/revenueCatEvents.ts. This file
 * only authenticates, loads the stored row, and writes the result.
 *
 * Auth: RevenueCat sends the Authorization header configured on the webhook; it
 * must equal `Bearer $REVENUECAT_WEBHOOK_SECRET`.
 * Out-of-order / duplicate deliveries are dropped by comparing event timestamps.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected), REVENUECAT_WEBHOOK_SECRET.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { applyRevenueCatEvent, type RevenueCatEvent } from '../../../src/domain/services/revenueCatEvents.ts';
import { isAuthorized } from './logic.ts';

const SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false },
});

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!isAuthorized(req.headers.get('Authorization'), SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let event: RevenueCatEvent | undefined;
  try {
    event = ((await req.json()) as { event?: RevenueCatEvent }).event;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (event == null || typeof event.type !== 'string') return new Response('Missing event', { status: 400 });

  const userId = event.app_user_id;
  const existing = userId == null
    ? null
    : (await admin.from('subscriptions').select('grace_expires_at, expires_at, last_event_ms').eq('user_id', userId)
      .maybeSingle()).data;
  const update = applyRevenueCatEvent(
    event,
    existing == null
      ? null
      : {
        graceExpiresAt: existing.grace_expires_at,
        expiresAt: existing.expires_at,
        lastEventMs: Number(existing.last_event_ms),
      },
  );
  // Not for us (test ping, anonymous user, other entitlement, stale): acknowledge
  // so RevenueCat does not retry it forever.
  if (update == null) return new Response('ignored', { status: 200 });

  const { error } = await admin.from('subscriptions').upsert({
    user_id: update.userId,
    entitlement: update.entitlement,
    expires_at: update.expiresAt,
    grace_expires_at: update.graceExpiresAt,
    auto_renew: update.autoRenew,
    last_event_ms: update.lastEventMs,
    updated_at: new Date().toISOString(),
  });
  if (error != null) {
    console.error('subscription upsert failed:', error.message);
    // 500 makes RevenueCat retry, which is what we want for a transient DB error.
    return new Response('Failed', { status: 500 });
  }
  return new Response('ok', { status: 200 });
});
