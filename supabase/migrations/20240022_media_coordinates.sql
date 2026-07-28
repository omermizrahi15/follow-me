-- Published media GPS (issue #78): the Me-page globe plots every posting where
-- it was taken, so the coordinate must survive publishing — until now only the
-- human-readable `location` label did (20240009), while the real fix lived on
-- candidate_photos (20240021) and was dropped at publish time.
--
-- Nullable: photos without a GPS fix, and every row that predates this column,
-- simply carry null and are left off the map until the backfill
-- (scripts/backfill-media-coordinates.js) geocodes their location label.

alter table media add column if not exists latitude double precision;
alter table media add column if not exists longitude double precision;
