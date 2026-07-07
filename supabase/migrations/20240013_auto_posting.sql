-- Issue #17 Part 2: autonomous server-side auto-posting.
-- Cloud copies of recent library photos the server can post without the device.
create table if not exists candidate_photos (
  publisher_id text not null,
  asset_id text not null,
  url text not null,
  created_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (publisher_id, asset_id)
);

create index if not exists candidate_photos_publisher_created_idx
  on candidate_photos (publisher_id, created_at desc);

alter table candidate_photos enable row level security;

-- Dev policies: open access for the anon role, matching the other tables.
-- TODO(production): replace with authenticated policies before launch —
--   for select/insert/update/delete to authenticated
--   using (auth.uid() = publisher_id) with check (auth.uid() = publisher_id)
-- and drop every dev_allow_* policy. Requires the app's Supabase clients to
-- attach the user session (they currently use the bare anon key).
-- See docs/PRODUCTION.md → "RLS hardening" for the full plan.
drop policy if exists dev_allow_select on candidate_photos;
create policy dev_allow_select on candidate_photos for select to anon using (true);

drop policy if exists dev_allow_insert on candidate_photos;
create policy dev_allow_insert on candidate_photos for insert to anon with check (true);

drop policy if exists dev_allow_update on candidate_photos;
create policy dev_allow_update on candidate_photos for update to anon using (true) with check (true);

drop policy if exists dev_allow_delete on candidate_photos;
create policy dev_allow_delete on candidate_photos for delete to anon using (true);

-- Schedule-at-local-time + autonomous-mode bookkeeping on the publisher config.
alter table publisher_config
  add column if not exists timezone text not null default 'UTC',
  add column if not exists expo_push_token text,
  add column if not exists last_auto_post_at timestamptz;
