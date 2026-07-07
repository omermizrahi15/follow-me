-- Align fresh environments with production (issue #13). Standing up staging
-- surfaced two drifts — manual dashboard changes in production that never
-- became migrations. Every statement is idempotent / a no-op on production.

-- subscribers: production's id is TEXT with a gen_random_uuid() default, has a
-- created_at audit column, and status has no column default. 20240004 documented
-- the intended schema with `create table if not exists`, but production's table
-- predates it, so fresh environments diverged.
alter table subscribers alter column id drop default;
alter table subscribers alter column id type text using id::text;
alter table subscribers alter column id set default gen_random_uuid();
alter table subscribers add column if not exists created_at timestamptz not null default now();
alter table subscribers alter column status drop default;

-- posts: the public web gallery (docs/gallery.html) reads post rows over
-- Supabase REST with the anon key — production has this SELECT policy but it
-- was created by hand. posts carries no PII: Cloudinary URLs + publisher id.
drop policy if exists "anon can read posts" on posts;
create policy "anon can read posts" on posts for select to anon using (true);
