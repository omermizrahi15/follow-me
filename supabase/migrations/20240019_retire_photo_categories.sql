-- Retire the 'view_only' and 'activity' photo categories.
-- They were low-signal for a travel share, so the app no longer classifies or
-- offers them. Clean them out of stored config so PublisherConfig validation
-- (which rejects unknown categories) keeps loading existing rows.

-- Strip the retired categories from every publisher's enabled set.
update publisher_config
  set enabled_categories =
    array_remove(array_remove(enabled_categories, 'view_only'), 'activity');

-- Any row left with no categories falls back to a sensible default so a scan
-- never silently returns zero photos.
update publisher_config
  set enabled_categories = array['selfie_with_view', 'selfie_with_people', 'food']
  where coalesce(array_length(enabled_categories, 1), 0) = 0;

-- Drop 'view_only' from the column default for newly-created rows.
alter table publisher_config
  alter column enabled_categories
  set default array['selfie_with_view', 'selfie_with_people', 'food'];
