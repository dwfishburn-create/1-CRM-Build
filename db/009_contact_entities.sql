-- Dan Fishburn CRM — v1 schema, migration 009
-- contact_entities — a real contact<->entity many-to-many join table, so
-- one person can be linked to more than one company/entity (e.g. a
-- principal of two separate restaurant concepts). Raised 8/31/2026 (see
-- CRM_Requirements_and_Decisions_Log.md, "Contact<->Entity relationship is
-- 1:1, not many-to-many" open question) when Reyes Aranda Jr. (CON-0023,
-- entity_id -> Team Clase Codigo LLC/ENT-0025) turned out to also be a
-- principal of a second, separate entity (Astlali Concina & Tequila) --
-- contacts.entity_id is a single FK, so only one "home company" could be
-- stored per contact, and Dan expects this to come up again with other
-- contacts/clients.
--
-- Deliberately additive, not a replacement: contacts.entity_id stays
-- exactly as-is and keeps meaning "primary/home entity" -- unchanged for
-- every existing contact and every existing query/embed that reads it
-- (app/api/agent/contacts/route.ts, app/contacts/page.tsx, etc.). This
-- matters because a *second direct* FK between contacts and entities is
-- exactly what caused the ambiguous-embed bug fixed 8/24/2026
-- (PostgREST couldn't infer which FK to join on with two between the same
-- table pair). contact_entities avoids that entirely -- its two FKs point
-- FROM the new join table, not a new one directly between contacts and
-- entities, so no existing embed becomes ambiguous.
--
-- contact_entities instead holds every OTHER entity affiliation a contact
-- has, each with its own role. Mirrors the project_contacts pattern
-- (migration 006): freeform role, unique on the pair so re-linking updates
-- instead of duplicating (same upsert semantics used throughout this
-- schema for join tables — project_properties, project_contacts, etc.).

create table contact_entities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  role text, -- freeform: Principal / Owner / Officer / Guarantor / Employee / etc. — no DB enum, same philosophy as project_contacts.role
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contact_id, entity_id)
);

create index idx_contact_entities_contact on contact_entities(contact_id);
create index idx_contact_entities_entity on contact_entities(entity_id);

alter table contact_entities enable row level security;
