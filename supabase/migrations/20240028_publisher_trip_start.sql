-- When the publisher's travels began (issue #81). The app measures posting
-- coverage against this date: if every cadence-sized stretch since it already
-- holds a posting there is nothing to reconstruct and the History tab stays
-- hidden, so this column is what decides whether the feature is offered at all.
--
-- `date`, not `timestamptz`: a trip starts on a day, not at an instant. Storing
-- a zoned timestamp would let a publisher in UTC+13 read their own start date
-- back as the day before.
--
-- Nullable — existing publishers have not been asked yet, and until they are
-- their coverage is unknowable rather than complete.

alter table publisher_profile add column if not exists trip_start_date date;
