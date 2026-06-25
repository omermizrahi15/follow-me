-- notification_log: an append-only audit trail of subscriber-facing messaging
-- events — currently STOP (opt_out) and START (opt_in) replies handled by the
-- join-webhook edge function. Required for messaging-compliance auditing: we
-- must be able to prove when a subscriber opted out and when they opted back in.
--
-- Written server-side from the edge function with the SERVICE-ROLE key, which
-- BYPASSES row level security. RLS is enabled with no anon policy on purpose:
-- the log references contact_handle (PII) and must never be publicly readable.

create table if not exists notification_log (
  id uuid primary key default gen_random_uuid(),
  -- Null when the inbound message can't be tied to a known subscriber row
  -- (e.g. a STOP from a number we have no record of). publisher_id/contact are
  -- still captured so the event is auditable.
  subscriber_id uuid,
  publisher_id text not null,
  contact_handle text not null,
  -- 'opt_out' (STOP / UNSUBSCRIBE) | 'opt_in' (START)
  event text not null,
  -- Free-form context, e.g. the raw inbound command word.
  detail text,
  created_at timestamptz not null default now()
);

-- Audit lookups are by contact handle ("show me everything for this number").
create index if not exists notification_log_contact_idx
  on notification_log (contact_handle);

alter table notification_log enable row level security;
