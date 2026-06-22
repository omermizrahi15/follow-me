create table if not exists publisher_config (
  publisher_id text primary key,
  frequency text not null default 'weekly',
  photos_per_post integer not null default 10,
  require_approval boolean not null default true
);

alter table publisher_config enable row level security;

-- Dev policies: open access for the anon role, matching the other tables.
-- save() upserts, so the anon role needs UPDATE in addition to INSERT/SELECT.
drop policy if exists dev_allow_select on publisher_config;
create policy dev_allow_select on publisher_config for select to anon using (true);

drop policy if exists dev_allow_insert on publisher_config;
create policy dev_allow_insert on publisher_config for insert to anon with check (true);

drop policy if exists dev_allow_update on publisher_config;
create policy dev_allow_update on publisher_config for update to anon using (true) with check (true);
