-- message_logs: delivery tracking for outbound WhatsApp messages (issue #24).
--
-- One row per Twilio message, keyed by the Twilio message SID. Rows are
-- inserted by the sending edge functions (send-post / auto-post / subscribe)
-- right after Twilio accepts a message, and updated by the `twilio-status`
-- edge function as Twilio posts StatusCallback events
-- (queued → sent → delivered, or failed / undelivered + error_code).
--
-- Written server-side with the SERVICE-ROLE key, which BYPASSES row level
-- security. RLS is enabled with no anon policy on purpose: rows carry
-- contact_handle (PII) and must never be publicly readable. The publisher-
-- facing "who is unreachable" signal is surfaced via subscribers.status
-- ('unreachable'), not by reading this table from the app.

create table if not exists message_logs (
  id uuid primary key default gen_random_uuid(),
  -- Twilio message SID (SM…/MM…). For sends Twilio rejected outright no SID
  -- exists, so a synthetic 'rejected-<uuid>' key is stored instead.
  message_sid text not null unique,
  publisher_id text not null,
  contact_handle text not null,
  -- Twilio lifecycle: queued | sent | delivered | read | undelivered | failed
  status text not null default 'queued',
  -- Twilio error code (e.g. '63024') when status is failed/undelivered.
  error_code text,
  -- Free-form context (error body excerpt).
  detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- StatusCallback updates look up by SID (covered by the unique index);
-- publisher-facing aggregation ("3 of 12 could not be reached") scans by publisher.
create index if not exists message_logs_publisher_idx
  on message_logs (publisher_id, created_at desc);

alter table message_logs enable row level security;
