-- Issue #54: optional song attached to a posting.
-- Stored twice on purpose, mirroring how the two viewers read their data:
--   media.song  — per media row (like location), grouped into postings by the
--                 app feed; every row of a batch carries the same song.
--   posts.song  — on the sent-batch row the public web gallery reads.
-- Shape: { title, artist, artworkUrl?, previewUrl?, sourceUrl? }
alter table media add column if not exists song jsonb;
alter table posts add column if not exists song jsonb;
