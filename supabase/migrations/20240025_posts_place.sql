-- The public gallery (docs/gallery.html) no longer shows only the post the
-- WhatsApp link points at: going back from it lists every post the publisher
-- has sent, mirroring the app's feed cards (place over date). Two things that
-- list needs and the row didn't carry:

-- 1. The place label. The message already names it ("… in Lisbon, Portugal"),
--    but it was composed into the caption and dropped. Nullable on purpose —
--    rows written before this migration, and batches with no GPS fix, have
--    none, and the card falls back to the date alone exactly like PostCard.
alter table posts add column if not exists place text;

-- 2. An index for the list query — posts by publisher, newest first.
create index if not exists posts_publisher_created_idx
  on posts (publisher_id, created_at desc);
