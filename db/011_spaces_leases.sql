-- Dan Fishburn CRM — v1 schema, migration 011
-- Adds the Space/Lease data model needed to ingest owner-provided rent
-- rolls (starting with The Shoppes at Lexington, PROP-0024 / project
-- CS-2802 Plum Creek Pky - Shoppes of Lexington) and to track lease
-- economics and renewal/option dates going forward. Phase 1 of a
-- two-phase build agreed in the CRM Requirements & Decisions Log —
-- lease_events (option/notice deadlines, rent bumps, TI disbursements)
-- and property_expenses (CAM/tax category breakout, multi-year history)
-- are deliberately deferred to Phase 2 until this core is proven against
-- real rent-roll data.
--
-- Design decisions baked in here (see decisions log for the full
-- discussion):
--   * Space is a new, dedicated table — NOT another parent_property_id
--     child-property row (the pattern used by PROP-0002/0003 and
--     PROP-0006/0007, migration 002). Those two existing pairs are left
--     as legacy and untouched; every new suite/space goes through this
--     table instead.
--   * Lease is the join record: it carries the tenant and landlord
--     relationship (both an entity and an optional specific contact on
--     each side) plus every economic term. property_owner (fee/title
--     ownership at the property level, migration 001/002) is untouched
--     and still independently answers "who owns this building" —
--     unaffected by who's currently leasing space in it.
--   * Master Lease / Sub Lease: a lease with master_lease_id set is a
--     Sublease — its landlord_entity_id is the Sub Landlord (the master
--     tenant, acting as landlord one level down). A lease with
--     master_lease_id null is a Master Lease — its landlord_entity_id is
--     the Master Landlord (normally the property's fee owner). Mirrors
--     live examples already in this CRM: the Hy-Vee/Ross sublease at
--     5040 N 27th and the UnitedHealth Group sublease in Norfolk.
--   * Renewals are new rows, not updates-in-place: is_current +
--     as_of_date give lightweight versioning (when a rent roll is
--     re-delivered with changed terms) without a full snapshot/import
--     table — that fuller model is parked until a deal actually needs to
--     reconstruct "what the rent roll said on date X" as a document.
--   * comp_eligible on leases defaults true — Dan doesn't want comp data
--     locked down; this is just a convenience filter, not an access
--     gate. Promoting a lease to a market comp means inserting a row
--     into the existing lease_comps table (migration 001), not a new
--     mechanism.
--   * trade_name on entities — retail tenants are commonly known by a
--     trade name/DBA that differs from the legal signing entity (e.g. a
--     Verizon authorized-retailer franchisee). Lets a tenant be entered
--     straight off a rent roll before the legal entity is researched.

-- ---------------------------------------------------------------------------
-- Entities: add trade_name (DBA)
-- ---------------------------------------------------------------------------
alter table entities
  add column trade_name text; -- commercial/trade name, when different from the legal name in `name`

-- ---------------------------------------------------------------------------
-- Spaces — a leasable unit within a property (or the whole property, for
-- a single-tenant building). Every space belongs to exactly one
-- property; a property can have any number of spaces.
-- ---------------------------------------------------------------------------
create table spaces (
  id uuid primary key default gen_random_uuid(),
  display_code text unique, -- SPACE-0001
  property_id uuid not null references properties(id) on delete cascade,
  suite_number text,
  building_sf numeric,
  space_status text not null default 'vacant'
    check (space_status in ('occupied','vacant','owner_occupied')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_spaces_property on spaces(property_id);
create index idx_spaces_status on spaces(space_status);

alter table spaces enable row level security;

-- ---------------------------------------------------------------------------
-- Leases — one row per lease term. A renewal at new terms is a new row,
-- not an update-in-place, so lease history is never overwritten.
-- ---------------------------------------------------------------------------
create table leases (
  id uuid primary key default gen_random_uuid(),
  display_code text unique, -- LEASE-0001
  space_id uuid not null references spaces(id) on delete cascade,

  tenant_entity_id uuid references entities(id) on delete set null,
  tenant_contact_id uuid references contacts(id) on delete set null, -- specific person, optional
  landlord_entity_id uuid references entities(id) on delete set null, -- Master Landlord if master_lease_id is null, else Sub Landlord
  landlord_contact_id uuid references contacts(id) on delete set null, -- specific person, optional

  master_lease_id uuid references leases(id) on delete set null,
  -- null = this row IS a Master Lease. Set = this row is a Sublease under
  -- that Master Lease (the Master Lease's tenant_entity_id is the Sub
  -- Landlord on this row's landlord_entity_id).

  lease_start_date date,
  lease_end_date date, -- null = open-ended / not yet known

  base_rent_annual numeric,
  base_rent_monthly numeric,
  rent_psf numeric,
  cam_payment_annual numeric, -- tenant's billed CAM/CAMIT reimbursement (lump sum)
  cam_psf numeric,
  ti_allowance numeric, -- lump sum; staged disbursement tracking is a Phase 2 (lease_events) concern

  is_current boolean not null default true,
  as_of_date date, -- date this row's terms were last confirmed (e.g. the rent roll's date)

  comp_eligible boolean not null default true, -- convenience filter only, not an access gate

  notes text, -- free text: rent-roll "Comments" column, tenancy history, sublease clarifications, etc.

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint leases_tenant_entity_or_contact
    check (tenant_entity_id is not null or tenant_contact_id is not null)
);

create index idx_leases_space on leases(space_id);
create index idx_leases_tenant_entity on leases(tenant_entity_id);
create index idx_leases_landlord_entity on leases(landlord_entity_id);
create index idx_leases_master_lease on leases(master_lease_id);
create index idx_leases_is_current on leases(is_current);

alter table leases enable row level security;
