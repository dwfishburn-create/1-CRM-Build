-- Dan Fishburn CRM — v1 schema, migration 006
-- Two small, independent additions from the parking lot in
-- CRM_Requirements_and_Decisions_Log.md (both raised 8/30/2026):
--
-- 1. project_contacts — a real contact<->project join table. Until now,
--    "who's on this project" was a log_activity entry per contact with
--    project_id set (used 8 times on SL-W2W-5040 N 27th, 8/30/2026) — a
--    workaround with no clean "list contacts on this project" query and no
--    way to remove a contact without another log entry. Mirrors the existing
--    project_properties pattern (upsert on the unique pair, so re-adding the
--    same contact just updates role/notes instead of erroring).
--
-- 2. reference_links — a structured place for standing deal-terms answers
--    (e.g. an NNN/CAM/tax figure) and shareable links (e.g. a Dropbox
--    marketing-package link) that were also going into activity_log as notes
--    (LOG-0023/LOG-0024 on SL-W2W-5040 N 27th). url is nullable so a
--    text-only standing answer can be logged without a link. No web UI for
--    the property_id/entity_id fields yet — same "Agent-API-only until the
--    UI catches up" pattern used for property_owner/property_tenant when
--    they first shipped (8/24/2026-8/25/2026).

-- ---------------------------------------------------------------------------
-- project_contacts
-- ---------------------------------------------------------------------------
create table project_contacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  role text, -- freeform: decision-maker / co-broker / referral / cooperating broker / etc. — no DB enum, same philosophy as activity_type/deal_type
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, contact_id)
);

create index idx_project_contacts_project on project_contacts(project_id);
create index idx_project_contacts_contact on project_contacts(contact_id);

alter table project_contacts enable row level security;

-- ---------------------------------------------------------------------------
-- reference_links — at least one of property_id/project_id is required;
-- entity_id is optional context (e.g. "this concerns Hy-Vee specifically").
-- url is nullable so a standing text answer with no link can still be
-- logged via notes alone.
-- ---------------------------------------------------------------------------
create table reference_links (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  entity_id uuid references entities(id) on delete set null,
  label text not null, -- e.g. "Marketing Package", "NNN/CAM/Tax standing answer"
  url text, -- a Dropbox shared link, etc. — optional
  link_type text, -- marketing_package / due_diligence / standing_answer / other — freeform, no DB enum
  notes text, -- the actual content when there's no url (e.g. the NNN/CAM/tax figures themselves)
  created_at timestamptz not null default now(),
  constraint reference_links_property_or_project
    check (property_id is not null or project_id is not null)
);

create index idx_reference_links_property on reference_links(property_id);
create index idx_reference_links_project on reference_links(project_id);

alter table reference_links enable row level security;
