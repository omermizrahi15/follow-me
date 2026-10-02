-- Travel globe on the follower website (issue #200).
--
-- The app's globe plots each posting where it was taken, reading the coordinate
-- from `media` (20240022). Followers never read `media` — it is owner-only —
-- they read `posts` through the anon key, so the coordinate has to live there
-- too for docs/gallery.html to draw the same globe.
--
-- Nullable: posts whose photos carried no GPS fix, and every row that predates
-- this column until the backfill below, are simply left off the globe.

alter table posts add column if not exists latitude double precision;
alter table posts add column if not exists longitude double precision;

-- Backfill from the posting's media rows, using the key 20240032 added. The
-- first located photo wins, the same rule the app's feed applies when it groups
-- a posting (ListFeedUseCase).
update posts p
set latitude = m.latitude,
    longitude = m.longitude
from (
  select distinct on (owner_id, posting_id) owner_id, posting_id, latitude, longitude
  from media
  where latitude is not null and longitude is not null and posting_id is not null
  order by owner_id, posting_id, created_at
) m
where p.posting_id = m.posting_id
  and p.publisher_id::text = m.owner_id::text
  and p.latitude is null;
