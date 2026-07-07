-- Issue #17: scheduled reminder + AI photo-suggestion settings.
-- Extends publisher_config with the reminder schedule and selection knobs.
alter table publisher_config
  add column if not exists notify_day_of_week integer not null default 0,
  add column if not exists notify_time text not null default '18:00',
  add column if not exists enabled_categories text[] not null
    default array['selfie_with_view', 'selfie_with_people', 'view_only', 'food'],
  add column if not exists lookback_days integer not null default 7,
  add column if not exists min_quality real not null default 0.4;
