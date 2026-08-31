-- Dan Fishburn CRM — v1 schema, migration 007
-- Roadmap item 7 (Map features): research-status markers + the polygon/
-- territory tool. See CRM_Requirements_and_Decisions_Log.md — the
-- 8/20/2026 "Property research status markers on the map" and "Polygon
-- property search" decisions, and the 8/26/2026 "Property map feature
-- split" + context-dependent-fields refinement.
--
-- 1. properties.priority — the polygon tool's candidate list is meant to
--    show "ownership research status, contact status, notes, property
--    type, size, and priority" per the 8/20/2026 decision, but no
--    priority field exists anywhere in the schema yet. Freeform text, no
--    check constraint — same convention as project_contacts.role and
--    reference_links.link_type — so Dan can use whatever scale he wants
--    (High/Medium/Low, A/B/C, a number) without a migration to add a
--    value.
--
-- 2. saved_polygons — "research zones" / "campaign territories" a drawn
--    polygon can be saved as and reloaded later, per the 8/20/2026
--    decision. Stores only the shape (a GeoJSON Polygon geometry) plus a
--    name/notes/optional project tie — never a snapshot of which
--    properties were inside it, because results must stay live (current
--    research status/ownership), per the 8/26/2026 refinement. The
--    optional project_id ties a zone to the Project/Assignment/Task it
--    was drawn for, per that same refinement ("pulls in whatever's
--    relevant to the current Project"); a zone with no project is a
--    general-purpose research area.
--
-- No PostGIS: at Omaha-market scale, polygon-contains-point checks run
-- client-side in JS (lib/geo.ts:pointInPolygon) against whatever
-- properties are already loaded, per the 8/26/2026 decision.

alter table properties add column priority text;

create table saved_polygons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  geojson jsonb not null, -- GeoJSON Polygon geometry: {"type":"Polygon","coordinates":[[[lng,lat],...]]}
  project_id uuid references projects(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_saved_polygons_project on saved_polygons(project_id);

alter table saved_polygons enable row level security;
