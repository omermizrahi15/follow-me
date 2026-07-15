-- Backfilled baseline (issue #13): `media` and `candidate_photos` were created
-- by hand in the production dashboard before the repo adopted migrations, so a
-- fresh environment (staging) breaks at 20240009, which ALTERs `media`.
-- Definitions below are dumped from production. Everything is idempotent:
-- production already has all of it (a re-run is a no-op) and new projects get
-- the exact schema production started from.
--
-- `media` is created as it was BEFORE 20240009 — later migrations add
-- posting_id/location (and add then drop media_type) on top of this.

create table if not exists media (
  id text not null,
  owner_id text not null,
  url text not null,
  created_at timestamptz not null default now(),
  -- production's PK name predates the table's rename from `photos`; keep it
  -- so environments stay diffable against production
  constraint photos_pkey primary key (id)
);

create index if not exists media_owner_created_idx
  on media (owner_id, created_at desc);

alter table media enable row level security;

drop policy if exists dev_allow_select on media;
create policy dev_allow_select on media for select to anon using (true);
drop policy if exists dev_allow_insert on media;
create policy dev_allow_insert on media for insert to anon with check (true);

create table if not exists candidate_photos (
  publisher_id text not null,
  asset_id text not null,
  url text not null,
  created_at timestamptz not null,
  synced_at timestamptz not null default now(),
  constraint candidate_photos_pkey primary key (publisher_id, asset_id)
);

create index if not exists candidate_photos_publisher_created_idx
  on candidate_photos (publisher_id, created_at desc);

alter table candidate_photos enable row level security;

drop policy if exists dev_allow_select on candidate_photos;
create policy dev_allow_select on candidate_photos for select to anon using (true);
drop policy if exists dev_allow_insert on candidate_photos;
create policy dev_allow_insert on candidate_photos for insert to anon with check (true);
drop policy if exists dev_allow_update on candidate_photos;
create policy dev_allow_update on candidate_photos for update to anon using (true) with check (true);
drop policy if exists dev_allow_delete on candidate_photos;
create policy dev_allow_delete on candidate_photos for delete to anon using (true);
