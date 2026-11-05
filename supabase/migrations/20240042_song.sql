-- Optional song on a post, picked by plain catalog search.
-- Stamped on every media row of a posting (like location).
-- Shape: { title, artist, artworkUrl? }
alter table media add column if not exists song jsonb;
