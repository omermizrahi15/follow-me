-- Issue #97: a scheduled post arrived as the empty "no photos have synced yet"
-- reminder instead of a photo batch, because cloud candidates are only uploaded
-- while the app is in the foreground and the phone hadn't been opened since the
-- previous posting. The old code sent that reminder immediately and stamped
-- last_auto_post_at, so one missed sync cost a whole posting cycle.
--
-- Three columns turn that into a grace window instead:
--
--   post_pending_since      — when the job first found an empty cloud set at a
--                             due tick. While set, the job keeps re-checking on
--                             every cron tick (the 30-minute due window has long
--                             closed by then, so this is what keeps it running)
--                             and sends the real batch the moment photos land.
--                             Cleared when the posting goes out or the grace
--                             window expires.
--   last_wake_push_at       — throttles the silent content-available push that
--                             wakes the device to sync. iOS budgets background
--                             pushes; one every ~45 min, not one per tick.
--   last_candidate_sync_at  — client heartbeat, written after every successful
--                             sync (including a zero-upload one). Lets the
--                             server tell "you have no new photos" from "this
--                             phone hasn't checked in", which need different copy.

alter table publisher_config
  add column if not exists post_pending_since timestamptz,
  add column if not exists last_wake_push_at timestamptz,
  add column if not exists last_candidate_sync_at timestamptz;
