-- Approval batches (issue #71): the auto-post job persists each computed
-- "batch ready to review" here, keyed by batch_id, instead of embedding the
-- full batch+pool in the push payload. APNs caps a push at 4KB and a 10-photo
-- batch (+ up to 20 pool) blew past that, so the rich push now carries only
-- batch_id + a compact gallery; the app fetches the full detail by id.
--
-- Rows are short-lived (one per due publisher per run) and safe to prune.
-- Dev-grade RLS mirrors candidate_photos: anon read/insert, filtered by
-- batch_id / publisher_id at the call site (same posture as the rest of the
-- schema — see 20240002).

create table if not exists approval_batches (
  batch_id text primary key,
  publisher_id text not null,
  batch jsonb not null,
  pool jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists approval_batches_publisher_created_idx
  on approval_batches (publisher_id, created_at desc);

alter table approval_batches enable row level security;

drop policy if exists dev_allow_select on approval_batches;
create policy dev_allow_select on approval_batches for select to anon using (true);
drop policy if exists dev_allow_insert on approval_batches;
create policy dev_allow_insert on approval_batches for insert to anon with check (true);
drop policy if exists dev_allow_delete on approval_batches;
create policy dev_allow_delete on approval_batches for delete to anon using (true);
