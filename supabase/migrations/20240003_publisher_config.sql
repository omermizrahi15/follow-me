create table if not exists publisher_config (
  publisher_id text primary key,
  frequency text not null default 'weekly',
  photos_per_post integer not null default 5,
  require_approval boolean not null default true
);
