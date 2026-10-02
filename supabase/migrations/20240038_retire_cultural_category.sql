-- Retire the `cultural` photo category, folding it into `architecture`.
--
-- Museums, temples, churches and historic sites are buildings. Having a
-- separate category for them mostly duplicated `architecture` and gave the
-- model another way to split photos that belong together — which reached the
-- publisher as "I switched architecture on and it never offers me the
-- cathedral I photographed", because the grade said `cultural` and `cultural`
-- was off.
--
-- Two places hold the retired value and both are rewritten here rather than
-- being tolerated forever in application code:
--
--   * candidate_photos.category — a cached grade. Left alone it matches no
--     enabled category, so the photo is silently dropped from every future
--     suggestion. Rewritten rather than re-graded: the AI budget is the
--     scarcest thing this app has, and a museum photo is an architecture photo
--     under any prompt.
--   * publisher_config.enabled_categories — the publisher's own choices. A
--     retired value sitting in the array is harmless to the selection rules
--     (nothing produces it any more) but it round-trips through the settings
--     form, so it would be written back every save and outlive this migration.
--
-- The app folds the value too (normaliseCategory / asCategory), because a
-- device's own grade cache is beyond the reach of any migration and an app
-- build that predates this one keeps sending the old prompt until it updates.

update candidate_photos
   set category = 'architecture'
 where category = 'cultural';

-- Strip 'cultural' from the array, but never leave a publisher with an EMPTY
-- one: `enabled_categories = {}` means "nothing may be suggested", which is a
-- far worse outcome than one extra category and is not what anybody chose.
-- A publisher whose only enabled category was `cultural` gets `architecture`,
-- which is what they had asked for in every sense that still exists.
update publisher_config
   set enabled_categories =
         case
           when array_remove(enabled_categories, 'cultural') = '{}'
             then array['architecture']
           -- array_append would put architecture at the END; the array is
           -- ordered by preference (see categoryOrdering), and a publisher who
           -- ranked cultural first meant it to outrank the rest.
           when 'architecture' = any(enabled_categories)
             then array_remove(enabled_categories, 'cultural')
           else array_replace(enabled_categories, 'cultural', 'architecture')
         end
 where 'cultural' = any(enabled_categories);
