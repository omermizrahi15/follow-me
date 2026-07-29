-- Trash for posts: deleting a post hides it from the publisher's feed and the
-- Me-page globe, but keeps the row so it can be restored from Settings →
-- Deleted posts. A soft delete rather than a real one because the photos have
-- already been sent to followers — dropping the row would only lose the
-- publisher's own copy, and there would be no way back.
--
-- Nullable and null for every existing row: null == live.

alter table media add column if not exists deleted_at timestamptz;

-- The feed reads only live rows; a partial index keeps that path from paying
-- for trashed ones. The full (owner_id, created_at) index from 20240002 still
-- serves the trash listing and the already-sent tracker, which read everything.
create index if not exists media_owner_live_idx
  on media (owner_id, created_at desc)
  where deleted_at is null;

-- Trashing and restoring are UPDATEs, and `media` only had select/insert
-- policies (20240002) — the app writes as `anon`, so without this every
-- delete silently affected zero rows. Same permissive dev posture as
-- candidate_photos; tightening all of them to auth.uid() is its own change.
drop policy if exists dev_allow_update on media;
create policy dev_allow_update on media for update to anon using (true) with check (true);
