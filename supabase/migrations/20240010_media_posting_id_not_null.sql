-- The feed groups on posting_id and treats a missing one as a bug, not data
-- (ListFeedUseCase throws). Enforce that at the schema level.
--
-- Rows without a posting_id exist: app builds predating 20240009 still write
-- media without stamping it. So: backfill what's there (bucketing by owner +
-- minute — items shared together land in the same minute and stay one
-- posting), then default new unstamped rows to a fresh id each (a single-item
-- posting, never a crashed insert), then forbid null outright.

update media
  set posting_id = 'posting-backfill-' || owner_id || '-' || to_char(created_at, 'YYYYMMDDHH24MI')
  where posting_id is null;

alter table media alter column posting_id set default gen_random_uuid()::text;
alter table media alter column posting_id set not null;
