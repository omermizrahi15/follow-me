-- Local development seed (issue #110).
--
-- Runs automatically on `supabase start` and `supabase db reset`, and only ever
-- against the local stack — `supabase db push` does not carry it, so it can
-- never reach staging or production.
--
-- What it buys you: a publisher who already exists, so a fresh clone signs in
-- and lands on a working Me page instead of an empty one. Pair it with the
-- test OTP in config.toml and local development needs no accounts and no
-- credentials for anyone else's project.
--
-- Sign in as:  phone +1 500 555 0006   code 123456
--
-- Everything is keyed to a fixed uuid so the rows below can reference the user
-- directly; GoTrue matches an incoming phone sign-in to this row rather than
-- creating a second user.

do $$
declare
  seed_user_id constant uuid := '00000000-0000-4000-a000-000000000001';
  seed_phone   constant text := '15005550006';
begin
  -- The auth user. Written straight to auth.users because the local stack has
  -- no SMS provider to sign up through; the columns set here are the ones
  -- GoTrue requires to treat the row as a confirmed phone account.
  insert into auth.users (
    instance_id, id, aud, role,
    phone, phone_confirmed_at,
    encrypted_password, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', seed_user_id, 'authenticated', 'authenticated',
    seed_phone, now(),
    '', now(), now(),
    '{"provider":"phone","providers":["phone"]}', '{}',
    '', '', '', ''
  ) on conflict (id) do nothing;

  -- Supabase looks up the login through auth.identities, so the phone provider
  -- has to point at the same user or the OTP would mint a second account.
  insert into auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    seed_phone, seed_user_id,
    jsonb_build_object('sub', seed_user_id::text, 'phone', seed_phone),
    'phone', now(), now(), now()
  ) on conflict (provider, provider_id) do nothing;

  -- The publisher themselves. Only the columns a human would recognise are set;
  -- every other setting keeps its schema default, which is what a real first
  -- run produces (LoadConfigUseCase falls back to exactly these values).
  insert into publisher_profile (publisher_id, display_name)
  values (seed_user_id::text, 'Local Dev')
  on conflict (publisher_id) do nothing;

  insert into publisher_config (publisher_id)
  values (seed_user_id::text)
  on conflict (publisher_id) do nothing;

exception when others then
  -- auth.* is Supabase's internal schema and can change under us. A seed that
  -- no longer fits it must not block `supabase start`: signing in with the test
  -- OTP creates the user anyway, and both tables above fall back to their
  -- defaults, so the only thing lost is the display name.
  raise warning 'seed: skipped the local publisher (%) — sign in with the test OTP and one will be created', sqlerrm;
end $$;
