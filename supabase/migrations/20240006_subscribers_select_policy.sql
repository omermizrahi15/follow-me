-- Let the publisher-facing app read subscribers.
--
-- The mobile app reads with the anon key (SupabaseSubscriberRepository). The
-- subscribers table has RLS enabled but, until now, no SELECT policy for the
-- anon role — so every publisher-facing read (the Followers list, the
-- post-share "few followers" check) came back empty even though rows existed.
-- The Supabase dashboard still showed them because it queries with the service
-- role, which bypasses RLS.
--
-- This adds a dev SELECT policy mirroring publisher_config / publisher_profile.
--
-- ⚠️ PII / dev-only: this exposes contact_handle (a phone number) to any anon
-- reader, because the app's subscriber client is unauthenticated and carries no
-- JWT to scope by. Before launch, route these reads through the authenticated
-- client and replace this with `using (auth.uid()::text = publisher_id)` so a
-- publisher can only read their own followers. Tracked in #9. Writes stay
-- service-role only (no anon insert/update policy) — contact_handle must not be
-- publicly writable.

drop policy if exists dev_allow_select on subscribers;
create policy dev_allow_select on subscribers for select to anon using (true);
