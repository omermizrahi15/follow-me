-- The app now queries with the signed-in user's JWT (issue #115): every
-- repository shares the one authenticated client instead of building its own
-- `persistSession: false` one. That changes the Postgres role a query runs as,
-- from `anon` to `authenticated` — and every dev policy on these tables was
-- written `to anon`, so without this migration RLS would deny the whole app the
-- moment the client refactor ships.
--
-- Widening the roles rather than replacing the policies: the expressions stay
-- `using (true)`, exactly as permissive as before, so this changes nothing about
-- who can read what. Scoping them to `auth.uid()` is issue #9 — which is what
-- the JWT was the prerequisite for.
--
-- Driven off pg_policies rather than a hand-written list so it can't drift from
-- the policy names actually in the database, and so re-running it is a no-op.

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and 'anon' = any(roles)
      and not ('authenticated' = any(roles))
  loop
    execute format(
      'alter policy %I on %I.%I to anon, authenticated',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename
    );
  end loop;
end $$;
