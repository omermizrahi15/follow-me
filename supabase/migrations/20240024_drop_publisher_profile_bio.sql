-- Retire the publisher profile bio ("description").
-- Followers already know the publisher, so the Me page no longer shows a bio
-- and neither onboarding nor Edit profile collects one. Nothing reads or
-- writes the column any more, so drop it rather than leave dead data around.

alter table publisher_profile drop column if exists bio;
