-- What the AI provider itself says its ceilings are.
--
-- Until now the only number the app could show was CLASSIFY_DAILY_QUOTA — a
-- figure invented in the classify-photos function's env defaults (500 photos a
-- user a day) that corresponds to nothing any vendor enforces. The real wall is
-- the provider's, it is per-ACCOUNT rather than per-user, and it is stated on
-- every response the provider sends. This is where the last such statement is
-- kept so the app can read it without spending a request to find out.
--
-- One row per provider+model, overwritten in place: a rate limit is a current
-- fact, not a history, and keeping every observation would grow a row per
-- classify call for a number only ever read as "the latest".
create table if not exists provider_limits (
  provider text not null,
  model text not null,
  -- Calls, and how many are left. Null when the provider named no such ceiling.
  request_limit int,
  request_remaining int,
  request_reset_seconds int,
  -- Tokens, and how many are left. This is the ceiling that actually binds a
  -- vision workload: an image costs ~1k tokens, so a token allowance divides
  -- into far fewer photos than the request allowance divides into calls.
  token_limit int,
  token_remaining int,
  token_reset_seconds int,
  -- When the provider said it. A limit is only true for a moment, and a
  -- reading from yesterday must be legible as stale rather than current.
  observed_at timestamptz not null default now(),
  primary key (provider, model)
);

-- Service role only, like classify_quota: the Edge Function writes it and the
-- Edge Function reads it back out to the app. No client touches this directly.
alter table provider_limits enable row level security;

-- Upsert in one statement so a burst of concurrent classify calls cannot
-- interleave into a half-written row.
create or replace function record_provider_limits(
  p_provider text,
  p_model text,
  p_request_limit int,
  p_request_remaining int,
  p_request_reset_seconds int,
  p_token_limit int,
  p_token_remaining int,
  p_token_reset_seconds int
)
returns void
language plpgsql
security definer
as $$
begin
  insert into provider_limits (
    provider, model,
    request_limit, request_remaining, request_reset_seconds,
    token_limit, token_remaining, token_reset_seconds,
    observed_at
  )
  values (
    p_provider, p_model,
    p_request_limit, p_request_remaining, p_request_reset_seconds,
    p_token_limit, p_token_remaining, p_token_reset_seconds,
    now()
  )
  on conflict (provider, model) do update set
    request_limit = excluded.request_limit,
    request_remaining = excluded.request_remaining,
    request_reset_seconds = excluded.request_reset_seconds,
    token_limit = excluded.token_limit,
    token_remaining = excluded.token_remaining,
    token_reset_seconds = excluded.token_reset_seconds,
    observed_at = excluded.observed_at;
end;
$$;
