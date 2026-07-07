-- Per-user daily quota for the classify-photos Edge Function.
-- The function increments atomically via increment_classify_quota() and
-- rejects requests once the day's count exceeds its limit.
create table if not exists classify_quota (
  user_id uuid not null,
  day date not null,
  count int not null default 0,
  primary key (user_id, day)
);

-- Only the service role (Edge Functions) touches this table.
alter table classify_quota enable row level security;

create or replace function increment_classify_quota(p_user uuid, p_inc int)
returns int
language plpgsql
security definer
as $$
declare new_count int;
begin
  insert into classify_quota (user_id, day, count)
  values (p_user, current_date, p_inc)
  on conflict (user_id, day) do update set count = classify_quota.count + p_inc
  returning count into new_count;
  return new_count;
end;
$$;
