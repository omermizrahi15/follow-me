create table if not exists publisher_profile (
  publisher_id text primary key,
  display_name text not null,
  bio text,
  avatar_url text
);

alter table publisher_profile enable row level security;

-- Dev policies: open access for the anon role, matching the other tables.
-- save() upserts, so the anon role needs UPDATE in addition to INSERT/SELECT.
drop policy if exists dev_allow_select on publisher_profile;
create policy dev_allow_select on publisher_profile for select to anon using (true);

drop policy if exists dev_allow_insert on publisher_profile;
create policy dev_allow_insert on publisher_profile for insert to anon with check (true);

drop policy if exists dev_allow_update on publisher_profile;
create policy dev_allow_update on publisher_profile for update to anon using (true) with check (true);
