-- Server-side grade cache for the autonomous poster.
--
-- `auto-post` re-classified every candidate in the lookback window on EVERY
-- cron tick — one Gemini call per photo, nothing remembered between runs. On
-- staging that meant 175 photos re-graded every 15 minutes against a free-tier
-- key that allows 5 requests per MINUTE, so the very first wave answered 429,
-- the whole run threw, and the publisher got no push at all (not even the
-- fallback reminder). The last approval batch went out 2026-08-14 while the
-- schedule sat frozen at 2026-08-17, re-entering the same wall every day.
--
-- The device has had a persistent grade cache since PR #122; the server had
-- none. These columns are that cache. They live on candidate_photos rather than
-- in a table of their own so a grade is pruned with the photo it describes
-- (auto-post's 35-day retention sweep, prune-candidate-photos-daily) instead of
-- needing its own lifecycle.
--
-- All nullable: `graded_at is null` is the "not yet classified" state, which is
-- exactly the work queue auto-post drains a bounded slice of per tick. Existing
-- rows backfill to null and get graded on the next few ticks.

alter table candidate_photos add column if not exists category text;
alter table candidate_photos add column if not exists confidence double precision;
alter table candidate_photos add column if not exists quality double precision;
alter table candidate_photos add column if not exists caption text;
alter table candidate_photos add column if not exists scene text;
alter table candidate_photos add column if not exists graded_at timestamptz;

-- The per-tick query is "ungraded candidates for this publisher, newest first".
-- Partial index: graded rows are the majority once the backlog drains, and they
-- are never what this lookup is after.
create index if not exists candidate_photos_ungraded_idx
  on candidate_photos (publisher_id, created_at desc)
  where graded_at is null;
