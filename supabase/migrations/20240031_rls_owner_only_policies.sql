-- RLS hardening (issue #9): replace every `dev_allow_*` policy with owner-only
-- access for the `authenticated` role.
--
-- Until now every table granted the `anon` role blanket CRUD, and the anon key
-- ships inside the app bundle — so anyone who extracted it could read every
-- publisher's photos, read every follower's phone number, rewrite anyone's
-- posting config and delete anyone's uploads.
--
-- This migration is only safe to apply once the app queries carry the user's
-- JWT (issue #115): the repositories share the authenticated client from
-- `src/infrastructure/supabase/client.ts`, so `auth.uid()` below resolves to
-- the signed-in publisher. Applying it against an older build blanks the app.
--
-- Two things deliberately stay readable by `anon`, because the public web
-- gallery (docs/gallery.html) is an unauthenticated page that reads them with
-- the anon key:
--   * `posts`      — already select-only for anon (20240018); untouched here.
--   * `publisher_profile` — display name + avatar, shown as the gallery's
--     header. Writes are locked to the owner below.
--
-- Server-side paths are unaffected: every Edge Function uses the service-role
-- key, which bypasses RLS entirely.
--
-- Ownership columns are `text` on every table here (they hold `auth.uid()` as
-- written by the app), hence the `auth.uid()::text` cast throughout.

-- ---------------------------------------------------------------- media
drop policy if exists dev_allow_select on media;
drop policy if exists dev_allow_insert on media;
drop policy if exists dev_allow_update on media;
drop policy if exists dev_allow_delete on media;

drop policy if exists owner_all on media;
create policy owner_all on media
  for all to authenticated
  using (auth.uid()::text = owner_id)
  with check (auth.uid()::text = owner_id);

-- ------------------------------------------------------ candidate_photos
drop policy if exists dev_allow_select on candidate_photos;
drop policy if exists dev_allow_insert on candidate_photos;
drop policy if exists dev_allow_update on candidate_photos;
drop policy if exists dev_allow_delete on candidate_photos;

drop policy if exists owner_all on candidate_photos;
create policy owner_all on candidate_photos
  for all to authenticated
  using (auth.uid()::text = publisher_id)
  with check (auth.uid()::text = publisher_id);

-- ------------------------------------------------------ publisher_config
drop policy if exists dev_allow_select on publisher_config;
drop policy if exists dev_allow_insert on publisher_config;
drop policy if exists dev_allow_update on publisher_config;
drop policy if exists dev_allow_delete on publisher_config;

drop policy if exists owner_all on publisher_config;
create policy owner_all on publisher_config
  for all to authenticated
  using (auth.uid()::text = publisher_id)
  with check (auth.uid()::text = publisher_id);

-- ----------------------------------------------------- publisher_profile
-- Public read stays: the gallery link a follower opens is unauthenticated and
-- renders the publisher's name/avatar from this table. The columns are exactly
-- (publisher_id, display_name, avatar_url) — what the publisher chose to show
-- followers, and nothing else. Writes are owner-only.
drop policy if exists dev_allow_select on publisher_profile;
drop policy if exists dev_allow_insert on publisher_profile;
drop policy if exists dev_allow_update on publisher_profile;

drop policy if exists public_read on publisher_profile;
create policy public_read on publisher_profile
  for select to anon, authenticated
  using (true);

drop policy if exists owner_write on publisher_profile;
create policy owner_write on publisher_profile
  for all to authenticated
  using (auth.uid()::text = publisher_id)
  with check (auth.uid()::text = publisher_id);

-- ----------------------------------------------------------- subscribers
-- Rows carry `contact_handle` (a phone number) — the single worst thing the
-- anon key could reach. Subscribing itself is server-side (the subscribe /
-- join-webhook functions use the service role), so no client insert path is
-- needed; the publisher only reads their own followers and revokes them.
drop policy if exists dev_allow_select on subscribers;
drop policy if exists dev_allow_insert on subscribers;
drop policy if exists dev_allow_update on subscribers;
drop policy if exists dev_allow_delete on subscribers;

drop policy if exists owner_all on subscribers;
create policy owner_all on subscribers
  for all to authenticated
  using (auth.uid()::text = publisher_id)
  with check (auth.uid()::text = publisher_id);

-- ------------------------------------------------------- approval_batches
drop policy if exists dev_allow_select on approval_batches;
drop policy if exists dev_allow_insert on approval_batches;
drop policy if exists dev_allow_update on approval_batches;
drop policy if exists dev_allow_delete on approval_batches;

drop policy if exists owner_all on approval_batches;
create policy owner_all on approval_batches
  for all to authenticated
  using (auth.uid()::text = publisher_id)
  with check (auth.uid()::text = publisher_id);

-- ------------------------------------------------- notification_deliveries
-- 20240016 explains that `message_logs` gets no anon policy because its rows
-- hold PII — and then granted anon full CRUD here, on a table keyed by the
-- same publisher. Same treatment as the rest now.
drop policy if exists dev_allow_select on notification_deliveries;
drop policy if exists dev_allow_insert on notification_deliveries;
drop policy if exists dev_allow_update on notification_deliveries;
drop policy if exists dev_allow_delete on notification_deliveries;

drop policy if exists owner_all on notification_deliveries;
create policy owner_all on notification_deliveries
  for all to authenticated
  using (auth.uid()::text = publisher_id)
  with check (auth.uid()::text = publisher_id);
