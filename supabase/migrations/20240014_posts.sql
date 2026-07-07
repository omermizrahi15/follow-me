-- Posts: one row per sent batch, so the WhatsApp message can link to a web
-- gallery (view-post Edge Function) showing every photo in full size.
create table if not exists posts (
  id text primary key,            -- deterministic hash of publisher + media urls
  publisher_id uuid not null,
  media_urls jsonb not null,      -- array of Cloudinary URLs
  created_at timestamptz not null default now()
);

-- Only the service role (Edge Functions) reads/writes posts.
alter table posts enable row level security;
