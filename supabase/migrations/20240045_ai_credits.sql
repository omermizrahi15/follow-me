-- AI credits from the one-time history-backfill pack (issue #252).
--
-- A pack adds photos on top of the plan's daily AI limit; classify-photos spends
-- them only for the part of a request that exceeds that limit. Written only by
-- the service role (revenuecat-webhook grants, classify-photos spends).
create table if not exists ai_credits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance int not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- One row per granting RevenueCat event: the primary key makes a redelivered
-- webhook grant exactly once.
create table if not exists ai_credit_grants (
  event_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  photos int not null check (photos > 0),
  created_at timestamptz not null default now()
);

alter table ai_credits enable row level security;
alter table ai_credit_grants enable row level security;

-- A user may read their own balance (the app can show it); nobody else writes.
drop policy if exists ai_credits_owner_read on ai_credits;
create policy ai_credits_owner_read on ai_credits
  for select to authenticated
  using (user_id = auth.uid());

-- Grants a pack once per event. Returns the new balance.
create or replace function grant_ai_credits(p_event text, p_user uuid, p_photos int)
returns int
language plpgsql
security definer
as $$
declare new_balance int;
begin
  insert into ai_credit_grants (event_id, user_id, photos)
  values (p_event, p_user, p_photos)
  on conflict (event_id) do nothing;
  if found then
    insert into ai_credits (user_id, balance) values (p_user, p_photos)
    on conflict (user_id) do update
      set balance = ai_credits.balance + p_photos, updated_at = now();
  end if;
  select balance into new_balance from ai_credits where user_id = p_user;
  return coalesce(new_balance, 0);
end;
$$;

-- Spends p_n credits atomically, all or nothing. True when they were available.
create or replace function spend_ai_credits(p_user uuid, p_n int)
returns boolean
language plpgsql
security definer
as $$
begin
  update ai_credits set balance = balance - p_n, updated_at = now()
  where user_id = p_user and balance >= p_n;
  return found;
end;
$$;

-- Service role only: these are money-adjacent, never callable by a client.
revoke all on function grant_ai_credits(text, uuid, int) from public, anon, authenticated;
revoke all on function spend_ai_credits(uuid, int) from public, anon, authenticated;
