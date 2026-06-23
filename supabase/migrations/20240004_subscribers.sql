-- Subscribers: followers who receive a publisher's photos on WhatsApp.
-- The table already exists in the project; these statements are idempotent so
-- the migration can be applied safely to document and harden the schema.

-- Intended schema. `if not exists` makes this a no-op on the existing table —
-- if your live `subscribers.id` has no default, also run the ALTER below.
create table if not exists subscribers (
  id uuid primary key default gen_random_uuid(),
  publisher_id text not null,
  contact_handle text not null,
  status text not null default 'active'
);

-- The join-webhook (service-role) upserts ON CONFLICT (publisher_id,
-- contact_handle) and does NOT supply an id, so:
--   1. that column pair must be unique, and
--   2. id must have a server-side default.
create unique index if not exists subscribers_publisher_contact_uniq
  on subscribers (publisher_id, contact_handle);

-- Safe to re-run; ensures the webhook's id-less insert gets an id.
alter table subscribers alter column id set default gen_random_uuid();

-- Subscribing happens server-side in the join-webhook edge function with the
-- service-role key, which BYPASSES row level security. No anon write policy is
-- added here on purpose: contact_handle is PII and must not be publicly
-- writable/readable. RLS policy design for the publisher-facing reads/revokes is
-- tracked in #9.
alter table subscribers enable row level security;
