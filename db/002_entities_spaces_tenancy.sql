-- Dan Fishburn CRM — v1 schema, migration 002
-- Unifies Owners + Companies into one `entities` table: a business, LLC,
-- trust, or individual can be BOTH an owner of one property and a tenant of
-- another (e.g. Palm Beach Tan owns its HQ but leases retail space
-- elsewhere) — role now lives in the relationship (property_owner /
-- property_tenant), not in which base table the record sits in.
--
-- Adds a Property/Space model: a property row can now carry a
-- parent_property_id, pointing at another property row. No parent = the
-- assessor-level building/parcel (has the APN). Has a parent = a leasable
-- space/suite inside that building, with its own address (which is often
-- different from the parcel's own address — e.g. 123 Main St the building,
-- 124 Main St the suite) and its own suite_number.
--
-- Adds property_tenant, mirroring the existing property_owner table, to
-- track lease/tenancy relationships the same way ownership is tracked.
--
-- No production data exists yet in owners/companies/property_owner/contacts
-- (confirmed empty via the live agent API immediately before this migration
-- was written), so this is a clean cutover rather than a data-preserving
-- migration. If that ever stops being true, migrate data before running this.

-- ---------------------------------------------------------------------------
-- Entities (replaces Owners + Companies)
-- ---------------------------------------------------------------------------
create table entities (
  id uuid primary key default gen_random_uuid(),
  display_code text unique, -- ENT-0001 (new convention, replaces OWN-#### / CO-####)
  name text not null,
  entity_type text, -- Individual / LLC / Trust / Partnership / Corporation / Other
  industry text,
  website text,
  primary_contact_id uuid references contacts(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_entities_name on entities(name);

alter table entities enable row level security;

-- ---------------------------------------------------------------------------
-- Properties: add Property/Space model + suite identifier
-- ---------------------------------------------------------------------------
alter table properties
  add column parent_property_id uuid references properties(id) on delete set null,
  add column suite_number text;

create index idx_properties_parent on properties(parent_property_id);

-- ---------------------------------------------------------------------------
-- Property <-> Owner link: repoint from owners(id) to entities(id)
-- ---------------------------------------------------------------------------
alter table property_owner drop column owner_id;
alter table property_owner add column entity_id uuid not null references entities(id) on delete cascade;
alter table property_owner add column is_headquarters boolean not null default false;

create index idx_property_owner_entity on property_owner(entity_id);

-- ---------------------------------------------------------------------------
-- Property <-> Tenant link (new) — mirrors property_owner, for leases
-- ---------------------------------------------------------------------------
create table property_tenant (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  entity_id uuid references entities(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null, -- specific person, optional
  lease_start_date date,
  lease_end_date date, -- null = current tenant
  is_current boolean not null default true,
  is_headquarters boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_tenant_entity_or_contact check (entity_id is not null or contact_id is not null)
);

create index idx_property_tenant_property on property_tenant(property_id);
create index idx_property_tenant_entity on property_tenant(entity_id);

alter table property_tenant enable row level security;

-- ---------------------------------------------------------------------------
-- Contacts: repoint from companies(id) to entities(id)
-- ---------------------------------------------------------------------------
alter table contacts drop column company_id;
alter table contacts add column entity_id uuid references entities(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Activity Log + Tasks: repoint from owners(id) to entities(id)
-- (original 001 schema had owner_id on both — no app screen ever wrote to
-- either table, so both are confirmed empty)
-- ---------------------------------------------------------------------------
alter table activity_log drop column owner_id;
alter table activity_log add column entity_id uuid references entities(id) on delete set null;

alter table tasks drop column owner_id;
alter table tasks add column entity_id uuid references entities(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Drop old tables (empty — no production data as of this migration)
-- ---------------------------------------------------------------------------
drop table owners;
drop table companies;
