-- Issue #11: notification delivery tracking and automatic retry.
--
-- One row per (photo, subscriber) pair, written by the app around each
-- WhatsApp send: 'pending' before the first attempt, 'sent' on success,
-- 'failed' once the retrying notifier has exhausted its backoff (1s/4s/16s).
-- `attempts`/`last_attempted_at` record the real send history so a future UI
-- can show per-photo delivery status.
--
-- NOTE: the issue calls this table notification_log, but that name is already
-- taken by the opt-out/opt-in compliance audit (migration 20240007), so the
-- delivery tracker lives in its own table.
--
-- No foreign keys on purpose (house style — see candidate_photos): the log is
-- an audit trail and must survive subscriber removal.

create table if not exists notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  -- media.id — the shared photo (text asset ids, not uuids).
  photo_id text not null,
  subscriber_id uuid not null,
  publisher_id text not null,
  -- 'pending' | 'sent' | 'failed'
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_attempted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Re-sharing the same photo to the same subscriber resets the row to
-- 'pending' (upsert on this pair) instead of accumulating duplicates.
create unique index if not exists notification_deliveries_photo_subscriber_uniq
  on notification_deliveries (photo_id, subscriber_id);

-- The future status UI lists deliveries per publisher, newest first.
create index if not exists notification_deliveries_publisher_created_idx
  on notification_deliveries (publisher_id, created_at desc);

alter table notification_deliveries enable row level security;

-- Dev policies: open access for the anon role — the app writes these rows
-- client-side with the anon key. No contact PII in this table (ids + status
-- only), but still:
-- TODO(production): replace with authenticated policies before launch —
--   using (auth.uid()::text = publisher_id) with check (auth.uid()::text = publisher_id)
-- and drop every dev_allow_* policy, like the other tables.
-- See docs/PRODUCTION.md → "RLS hardening" for the full plan.
drop policy if exists dev_allow_select on notification_deliveries;
create policy dev_allow_select on notification_deliveries for select to anon using (true);

drop policy if exists dev_allow_insert on notification_deliveries;
create policy dev_allow_insert on notification_deliveries for insert to anon with check (true);

drop policy if exists dev_allow_update on notification_deliveries;
create policy dev_allow_update on notification_deliveries for update to anon using (true) with check (true);

drop policy if exists dev_allow_delete on notification_deliveries;
create policy dev_allow_delete on notification_deliveries for delete to anon using (true);
