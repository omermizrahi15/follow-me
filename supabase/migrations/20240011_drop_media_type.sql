-- The app is photos-only: video support was removed end to end, so the
-- media_type column (added in 20240009) has nothing left to distinguish.

alter table media drop column if exists media_type;
