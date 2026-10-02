-- Optional caption on a post (issue #220): the publisher's own words, sent to
-- followers with the photos and shown under them on the gallery page.
--
-- Both nullable and null for every existing row: null == no caption, which is
-- exactly how every post to date was sent.

-- The gallery page reads `posts`, so the caption has to live there for
-- followers to see it.
alter table posts add column if not exists caption text;

-- The publisher's own feed reads `media`. Every photo of a posting carries the
-- same value, like `location`, so any one row can speak for the batch.
alter table media add column if not exists caption text;
