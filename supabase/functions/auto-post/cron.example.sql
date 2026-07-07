-- Schedule the auto-post Edge Function. Run once in the Supabase SQL editor.
-- Replace <PROJECT_REF> and <CRON_SECRET> (must match the function's CRON_SECRET).
-- (Prefer storing the secret in Supabase Vault; inlined here for clarity.)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Fire every 15 minutes; the function itself decides who is "due" (timezone-aware).
select cron.schedule(
  'auto-post-every-15-min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/auto-post',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Daily prune so candidate_photos can't grow unbounded (keep ~60 days, the max
-- any publisher's lookback would use).
select cron.schedule(
  'prune-candidate-photos-daily',
  '17 3 * * *',
  $$ delete from candidate_photos where created_at < now() - interval '60 days'; $$
);

-- To remove:  select cron.unschedule('auto-post-every-15-min');
--             select cron.unschedule('prune-candidate-photos-daily');
