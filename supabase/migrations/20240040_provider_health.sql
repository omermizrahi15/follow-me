-- Whether each AI provider is actually working (issue #202).
--
-- Groq retired the model we asked for and every request to it failed for two and
-- a half weeks. The Edge Function fell back to Gemini and kept answering, so
-- nothing anywhere said grading was running on the safety net. provider_limits
-- already holds one row per provider+model; this adds the one fact it lacked:
-- since when has this provider been failing, and with what.
--
-- A fault is a retired model, a revoked key, an outage — NOT a spent daily
-- budget or a per-minute limit, which are normal and clear by themselves.
alter table provider_limits
  add column if not exists failing_since timestamptz,
  add column if not exists last_failure_status int,
  add column if not exists last_failure_detail text,
  add column if not exists last_ok_at timestamptz;

-- ok = true clears the failure and stamps last_ok_at; ok = false opens one
-- (keeping the ORIGINAL start across repeated failures) and records the latest
-- status. Upserts, because a provider that has never answered has no row yet.
create or replace function record_provider_health(
  p_provider text,
  p_model text,
  p_ok boolean,
  p_status int,
  p_detail text
)
returns void
language plpgsql
security definer
as $$
begin
  insert into provider_limits (provider, model, failing_since, last_failure_status, last_failure_detail, last_ok_at)
  values (
    p_provider, p_model,
    case when p_ok then null else now() end,
    case when p_ok then null else p_status end,
    case when p_ok then null else left(p_detail, 500) end,
    case when p_ok then now() else null end
  )
  on conflict (provider, model) do update set
    failing_since = case when p_ok then null else coalesce(provider_limits.failing_since, now()) end,
    last_failure_status = case when p_ok then null else p_status end,
    last_failure_detail = case when p_ok then null else left(p_detail, 500) end,
    last_ok_at = case when p_ok then now() else provider_limits.last_ok_at end;
end;
$$;

revoke all on function record_provider_health(text, text, boolean, int, text) from public, anon, authenticated;
