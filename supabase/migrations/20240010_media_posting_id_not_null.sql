-- The feed groups media into postings by posting_id, and a missing one is a
-- bug, not data (ListFeedUseCase throws). Enforce that at the schema level.
-- The default covers writers that don't stamp a posting_id themselves: each
-- such row becomes its own single-item posting instead of a failed insert.

alter table media alter column posting_id set default gen_random_uuid()::text;
alter table media alter column posting_id set not null;
