-- "Post now" posts in the background (no app launch): the phone fires
-- POST /post-batch and the server does the fan-out. Two columns make that safe
-- and useful:
--
--   posted_at  — the idempotency latch. iOS can redeliver a notification
--                response (background launch racing a later foreground one),
--                and the app also replays an unhandled response on next open,
--                so post-batch claims the row with a conditional update and a
--                second call is a no-op instead of a double send.
--   posting_id — the posting the batch became, so the "Posted ✓" push can deep
--                link to it and a replayed call can return the same link.

alter table approval_batches
  add column if not exists posted_at timestamptz,
  add column if not exists posting_id text;

-- Partial index: the only lookups that care are "has this batch been posted",
-- and unposted rows are the short-lived majority.
create index if not exists approval_batches_posted_idx
  on approval_batches (publisher_id, posted_at desc)
  where posted_at is not null;
