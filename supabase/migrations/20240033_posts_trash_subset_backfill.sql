-- Finishes the backfill 20240032 started.
--
-- That migration linked each `posts` row to its posting by requiring the two
-- url sets to be equal. Too strict: one posting can produce several posts rows,
-- because `savePostGallery` hashes the urls actually sent, and a send that
-- carried a subset of the batch hashes to a different id and gets a row of its
-- own. On staging a single 10-photo posting had four rows — the full one plus
-- partials of 4, 3 and 2 photos. Only the full one matched, so trashing the
-- posting left three of its four gallery links live.
--
-- Matching by containment instead: if every url in a posts row belongs to one
-- and the same posting, that posting is where the row came from. Rows whose
-- urls span several postings, or match none, are left untouched — an ambiguous
-- link is worse than no link, since it would hide a post nobody deleted.
--
-- Only rows still unlinked are considered, so this cannot revisit anything
-- 20240032 already resolved. New sends don't rely on any of this: they carry
-- `posting_id` from the send itself, subsets included.

with expanded as (
  select p.id as post_id, p.publisher_id, u.url
  from posts p, lateral jsonb_array_elements_text(p.media_urls) as u(url)
  where p.posting_id is null
),
totals as (
  -- Distinct, because a row that repeats a url must not need it matched twice.
  select post_id, count(distinct url) as total_urls
  from expanded
  group by post_id
),
candidate as (
  -- How much of each posts row each posting accounts for. `media.owner_id` is
  -- text and `posts.publisher_id` is uuid, hence the cast.
  select e.post_id, m.owner_id, m.posting_id, count(distinct e.url) as matched_urls
  from expanded e
  join media m on m.url = e.url and m.owner_id = e.publisher_id::text
  group by e.post_id, m.owner_id, m.posting_id
),
resolved as (
  select c.post_id, c.owner_id, c.posting_id
  from candidate c
  join totals t on t.post_id = c.post_id
  where c.matched_urls = t.total_urls
),
unambiguous as (
  -- Exactly one posting contains the whole row. `max()` picks the single value
  -- the HAVING clause has already established is alone.
  select post_id, max(owner_id) as owner_id, max(posting_id) as posting_id
  from resolved
  group by post_id
  having count(*) = 1
)
update posts p
set posting_id = r.posting_id,
    -- A posting is trashed as a unit, so any row of the group carries the time;
    -- null (live) when it was never deleted.
    deleted_at = (
      select min(m.deleted_at) from media m
      where m.owner_id = r.owner_id and m.posting_id = r.posting_id
    )
from unambiguous r
where p.id = r.post_id;
