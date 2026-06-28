-- Let the publisher-facing app write subscribers — specifically, removing a
-- follower (RemoveSubscriberUseCase) goes through SupabaseSubscriberRepository
-- with the anon key and calls save(), which upserts. Postgres RLS checks the
-- INSERT policy's WITH CHECK even on the ON CONFLICT DO UPDATE path of an
-- upsert, so both INSERT and UPDATE policies are required. Until now neither
-- existed (20240004 deliberately left subscribers writable only by the
-- service role), so every "Remove follower" tap failed with
-- "new row violates row-level security policy for subscribers".
--
-- This adds dev INSERT/UPDATE policies mirroring publisher_config /
-- publisher_profile and the dev SELECT policy from 20240006.
--
-- ⚠️ PII / dev-only: this lets any anon key holder insert or update any
-- subscriber row (including contact_handle, a phone number), because the app's
-- subscriber client is unauthenticated and carries no JWT to scope by. Before
-- launch, route these writes through the authenticated client and replace this
-- with `using (auth.uid()::text = publisher_id)` so a publisher can only write
-- their own followers — same gap already flagged in #9 for the read side.

drop policy if exists dev_allow_insert on subscribers;
create policy dev_allow_insert on subscribers for insert to anon with check (true);

drop policy if exists dev_allow_update on subscribers;
create policy dev_allow_update on subscribers for update to anon using (true) with check (true);
