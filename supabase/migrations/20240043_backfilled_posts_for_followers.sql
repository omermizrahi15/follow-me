-- Reconstructed history never reached followers.
--
-- Followers do not read `media`: they open docs/gallery.html, which reads
-- `posts`, one row per sent batch, written by the send functions. A history
-- backfill is deliberately silent (it writes `media` directly and notifies
-- nobody), so it never went through a send function and never got a `posts`
-- row — the publisher saw their rebuilt trip in their own feed and followers
-- saw none of it.
--
-- The app has no insert path into `posts` (RLS grants it update only), so the
-- mirror lives in the database: a statement trigger on `media` writes one
-- `posts` row per backfilled posting, dated by its photos (`created_at` comes
-- straight from the media rows, which the app stamps with the newest photo's
-- date) so the gallery orders reconstructed stretches by when they happened
-- rather than by when they were published.
--
-- Must never break the media write it hangs off, so any failure is swallowed.
-- The coordinate is rounded to one decimal place (~11 km) exactly as
-- savePostGallery does: `posts` is readable with the public anon key.

create or replace function mirror_backfilled_postings() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into posts (id, publisher_id, media_urls, place, posting_id, latitude, longitude, created_at)
    select left(encode(sha256(convert_to(owner_id || '|' || string_agg(url, '|' order by url), 'UTF8')), 'hex'), 20),
           owner_id::uuid,
           jsonb_agg(url order by url),
           max(location),
           posting_id,
           round(((array_agg(latitude order by id) filter (where latitude is not null))[1])::numeric, 1)::double precision,
           round(((array_agg(longitude order by id) filter (where longitude is not null))[1])::numeric, 1)::double precision,
           min(created_at)
    from new_rows
    where backfilled
      and posting_id is not null
      and owner_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    group by owner_id, posting_id
    on conflict (id) do update
      set place = excluded.place,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          created_at = excluded.created_at;
  exception when others then
    raise warning 'mirror_backfilled_postings failed: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists media_backfilled_insert on media;
create trigger media_backfilled_insert
  after insert on media
  referencing new table as new_rows
  for each statement execute function mirror_backfilled_postings();

drop trigger if exists media_backfilled_update on media;
create trigger media_backfilled_update
  after update on media
  referencing new table as new_rows
  for each statement execute function mirror_backfilled_postings();

-- Postings backfilled before this migration: give them the row they never got.
-- A trashed posting carries its deletion over, so nothing the publisher deleted
-- becomes visible.
insert into posts (id, publisher_id, media_urls, place, posting_id, latitude, longitude, created_at, deleted_at)
select left(encode(sha256(convert_to(owner_id || '|' || string_agg(url, '|' order by url), 'UTF8')), 'hex'), 20),
       owner_id::uuid,
       jsonb_agg(url order by url),
       max(location),
       posting_id,
       round(((array_agg(latitude order by id) filter (where latitude is not null))[1])::numeric, 1)::double precision,
       round(((array_agg(longitude order by id) filter (where longitude is not null))[1])::numeric, 1)::double precision,
       min(created_at),
       min(deleted_at)
from media
where backfilled
  and posting_id is not null
  and owner_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
group by owner_id, posting_id
on conflict (id) do nothing;
