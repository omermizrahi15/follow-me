-- Paid subscriptions (issue #252).
--
-- One row per user, kept current by the revenuecat-webhook Edge Function from
-- RevenueCat's events. The row only RECORDS what the store says; which plan a
-- user is on is decided in src/domain/services/plans.ts (planFromSubscription),
-- shared by every Edge Function, so the rule exists once.
create table if not exists subscriptions (
  -- Cascades from the login: deleting an account (delete-account, issue #253)
  -- removes the auth user LAST, which takes this row with it. It is deliberately
  -- NOT in USER_DATA_TABLES, so account deletion works whether or not this
  -- migration has reached a given project yet. Deleting the account does not
  -- cancel the store subscription — that is Apple's, ended in Apple ID settings.
  user_id uuid primary key references auth.users (id) on delete cascade,
  entitlement text not null default 'plus',
  -- End of the paid period. Cancelling does not move this; only the store does.
  expires_at timestamptz,
  -- End of the store's billing-retry grace window, when a renewal failed.
  grace_expires_at timestamptz,
  auto_renew boolean not null default true,
  -- RevenueCat's event_timestamp_ms for the last applied event, so a late
  -- duplicate or out-of-order delivery cannot roll the row backwards.
  last_event_ms bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table subscriptions enable row level security;

-- A user may read their own row (the app can show the plan); nobody but the
-- service role writes, so a client can never grant itself Plus.
drop policy if exists subscriptions_owner_read on subscriptions;
create policy subscriptions_owner_read on subscriptions
  for select to authenticated
  using (user_id = auth.uid());
