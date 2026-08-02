-- History backfill (issue #81): publishers who join mid-trip reconstruct their
-- past travels as back-dated postings. Those postings are written straight to
-- `media` and deliberately notify nobody — ten reconstructed trips must not
-- fire ten WhatsApp blasts at every follower.
--
-- The flag marks them so the feed can badge reconstructed history and so
-- nothing downstream (delivery audits, resend tooling) mistakes a backfilled
-- item for a send that failed to reach anyone. Existing rows are all live
-- sends, hence the false default.

alter table media add column if not exists backfilled boolean not null default false;
