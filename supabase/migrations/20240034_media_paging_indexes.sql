-- The feed is read a page at a time now (issue #116), and paging needs a total
-- order: every photo of a posting is written with the same created_at, so
-- (owner_id, created_at desc) leaves whole batches tied and two pages of a tied
-- run can repeat rows and skip others. The app orders by the id as well; this
-- index puts that order in the index so a page is a range scan rather than a
-- sort of everything the publisher has ever posted.
--
-- It also covers `postedAssetIds` — select id where owner_id = $1, the check
-- that runs on every suggestion scan — as an index-only scan, without touching
-- the table at all.
create index if not exists media_owner_created_id_idx
  on media (owner_id, created_at desc, id);

-- Now redundant: a strict prefix of the index above, so every plan that used it
-- can use the new one. The partial `media_owner_live_idx` (20240030) stays —
-- it is smaller and still the cheaper answer for live-only reads.
drop index if exists media_owner_created_idx;
