-- Deleting a post has to hide it from followers too.
--
-- Trashing writes `media.deleted_at` (20240030) — the publisher's own feed.
-- Followers never read `media`: they open docs/gallery.html, which reads
-- `posts`, one row per sent batch written by savePostGallery. Nothing updated
-- that row on delete, so every trashed post stayed live for followers — and the
-- gallery lists *every* post by the publisher, not just the linked one, so a
-- publisher down to one post was still showing followers all six.
--
-- The two tables also shared no key: `posts.id` is a hash of publisher + media
-- urls, `media.posting_id` is the batch id stamped at share time. This adds
-- that key, plus the flag the gallery filters on.

alter table posts add column if not exists posting_id text;
alter table posts add column if not exists deleted_at timestamptz;

-- The feed query is publisher + newest-first and now reads only live rows.
create index if not exists posts_publisher_live_idx
  on posts (publisher_id, created_at desc)
  where deleted_at is null;

-- Trash/restore matches on (publisher, posting) — the same shape the media
-- write uses, so one delete touches one row on each side.
create index if not exists posts_publisher_posting_idx
  on posts (publisher_id, posting_id);

-- Backfill: rows already in `posts` carry no posting_id, so link them by what
-- both sides do hold — the batch's photo urls. Compared as sorted arrays, since
-- neither table records the order the batch was sent in. A publisher can't have
-- two postings with the same url set (the urls are per-upload Cloudinary ids,
-- and an identical set hashes to the same posts row anyway), so the match is
-- unique. Postings already in the trash get their deletion time carried over,
-- which is what retroactively hides the posts this bug leaked.
with posting as (
  select owner_id,
         posting_id,
         array_agg(url order by url) as urls,
         -- A posting is trashed as a unit, so every row of a group carries the
         -- same value; null (live) when it was never deleted.
         min(deleted_at) as deleted_at
  from media
  where posting_id is not null
  group by owner_id, posting_id
)
update posts p
set posting_id = posting.posting_id,
    deleted_at = posting.deleted_at
from posting
-- `publisher_id` is uuid here and text in `media` (it holds auth.uid() as the
-- app wrote it); cast both rather than assume either.
where p.posting_id is null
  and p.publisher_id::text = posting.owner_id
  and (
    select array_agg(u order by u)
    from jsonb_array_elements_text(p.media_urls) as t(u)
  ) = posting.urls;

-- The gallery page is unauthenticated and reads with the anon key, so the
-- filter belongs in the policy, not in the query: a trashed post is then
-- unreachable even to a hand-written REST call, and the page needs no change to
-- benefit (it selects `*`, and naming a column that a not-yet-migrated
-- environment lacks would 400 the whole feed).
drop policy if exists "anon can read posts" on posts;
create policy "anon can read posts" on posts
  for select to anon
  using (deleted_at is null);

-- Trashing is the one write the app makes to this table — every other write is
-- an Edge Function on the service role, which bypasses RLS. Owner-scoped, like
-- every policy in 20240031.
drop policy if exists owner_update on posts;
create policy owner_update on posts
  for update to authenticated
  using (auth.uid()::text = publisher_id::text)
  with check (auth.uid()::text = publisher_id::text);
