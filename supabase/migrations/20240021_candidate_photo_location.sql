-- Candidate photo GPS (issue #23): store each synced photo's coordinate so the
-- autonomous auto-post job can name the posting's place (city, country) without
-- the device. Nullable — most fields backfill null and photos without a GPS fix
-- simply stay null. The job reverse-geocodes the batch's representative point.

alter table candidate_photos add column if not exists latitude double precision;
alter table candidate_photos add column if not exists longitude double precision;
