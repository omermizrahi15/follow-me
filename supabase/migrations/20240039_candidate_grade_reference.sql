-- Remember the face answer alongside the rest of a cached grade.
--
-- "Photos of me" (issue #137) asks the classifier one extra question per photo:
-- does the person in the publisher's profile portrait appear in it? The device
-- has remembered that answer since the feature shipped. The SERVER never did:
-- migration 20240036 cached category, confidence, quality, caption and scene,
-- and dropped `contains_reference_person` on the floor.
--
-- The consequence is not a missing nicety, it is the feature inverted. auto-post
-- reconstructs a grade from these columns and fills the face answer with
-- `false`, so every photo graded on an earlier tick reads as "the publisher is
-- not in this one". Under `prefer` the preference silently does nothing; under
-- `only` it filters the entire batch away and the post comes back empty. And
-- since the grade cache is what makes the autonomous poster affordable at all,
-- the cached path is the normal path — the answer was only ever right on the
-- single tick a photo was first graded.
--
-- `graded_reference` is the other half. A grade bought while looking for NO
-- face says `false` for the trivial reason that nobody looked, which is
-- indistinguishable from a real "not in this photo" once stored. Recording
-- which reference the grade was bought against lets auto-post tell them apart
-- and re-grade when the question has changed — exactly what the device's own
-- cache does with its `referenceKey` (see ClassificationCache.answersReference).
-- Null means "no face was looked for", which is the normal case: the preference
-- is off for most publishers and no reference is ever sent.

alter table candidate_photos
  add column if not exists contains_reference_person boolean,
  add column if not exists reference_confidence double precision,
  add column if not exists graded_reference text;

-- Existing graded rows were all bought without a reference — the column did not
-- exist, so no request that produced them could have carried one. Left as null
-- rather than backfilled to false: null is "not asked", false is "asked and no",
-- and conflating them is the whole bug above.
