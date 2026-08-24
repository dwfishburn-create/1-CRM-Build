-- Dan Fishburn CRM — v1 schema, migration 003
-- Adds the core relationship the Projects screen needs: a project can carry
-- multiple candidate properties/spaces at once, each tracked through a
-- status (Candidate/Toured/Selected/Rejected) as the search progresses —
-- not just a single property a project happens to close on. This was the
-- original gap that triggered the 8/24/2026 Entities/Property-Space work
-- (see CRM_Requirements_and_Decisions_Log.md), and Dan confirmed the
-- multi-candidate-with-status design when asked directly.
--
-- projects.property_id (a single nullable FK) is dropped in favor of this
-- join table — keeping both would just create two conflicting ways to
-- represent "which property is this project about." No production data
-- exists yet in `projects` (confirmed empty via a read-only count query run
-- directly in the Supabase SQL Editor immediately before writing this
-- migration), so this is a clean cutover rather than a data-preserving one.

-- ---------------------------------------------------------------------------
-- Project <-> Property candidate link
-- ---------------------------------------------------------------------------
create table project_properties (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  status text not null default 'candidate'
    check (status in ('candidate', 'toured', 'selected', 'rejected')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, property_id)
);

create index idx_project_properties_project on project_properties(project_id);
create index idx_project_properties_property on project_properties(property_id);

alter table project_properties enable row level security;

-- ---------------------------------------------------------------------------
-- Projects: drop the old single-property FK, superseded by project_properties
-- ---------------------------------------------------------------------------
alter table projects drop column property_id;
