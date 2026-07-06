-- The Home feed renders uploaded media grouped into "postings" — the batch of
-- items shared together in one send (issue #44). Persist what the feed needs:
--
--   media_type  since dropped in 20240011 — the app went photos-only.
--   posting_id  shared by every item of one ShareMediaUseCase.share() call;
--               the feed groups on it. Nullable here; 20240010 makes it
--               NOT NULL with a per-row default.
--   location    optional place label; stays null until media GPS metadata is
--               reverse-geocoded (issue #23).

alter table media add column if not exists media_type text not null default 'image';
alter table media add column if not exists posting_id text;
alter table media add column if not exists location text;

-- The feed reads a publisher's media newest-first.
create index if not exists media_owner_created_idx
  on media (owner_id, created_at desc);
