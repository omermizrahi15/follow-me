-- Issue #97 follow-up: the server could see that a publisher's cloud photo set
-- was empty, but never why. Migration 20240026 added last_candidate_sync_at,
-- which distinguishes "no new photos" from "this phone hasn't checked in" —
-- but not the case that actually happened in production: photo upload was
-- switched OFF on the device (paused by a "Remove my photos from the cloud"
-- wipe, or never consented to), and no amount of waiting or waking would ever
-- produce a photo.
--
-- The server treated that as a stale client and pushed "Open Follow Me so your
-- recent photos can upload", which is advice that cannot work — the app was
-- opened many times and the flag kept sync off regardless.
--
-- photo_sync_state is the device saying which of the three it is:
--   'active'     — syncing normally (written with last_candidate_sync_at)
--   'paused'     — suspended after a cloud-photo wipe, until the user re-enables
--   'no-consent' — the upload prompt has never been accepted
--
-- Null means a device that predates this column; the job falls back to the
-- 20240026 heartbeat behaviour for those, so old builds keep working.

alter table publisher_config
  add column if not exists photo_sync_state text;
