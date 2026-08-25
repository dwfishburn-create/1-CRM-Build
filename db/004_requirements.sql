-- Dan Fishburn CRM — v1 schema, migration 004
-- Adds Requirements (aka Req/RQ/Need) as a first-class object, per the
-- design settled in CRM_Requirements_and_Decisions_Log.md on 8/22/2026 and
-- picked up for the build per the 8/25/2026 build-order decision
-- (Requirements → Tasks/Dashboard → Sale/Lease Comps as-needed).
--
-- A Requirement is a standing, informal capture of what someone told Dan
-- they need ("let me know if you find/come across this for me") — distinct
-- from an Assignment (the formal TR/BR/CL/CS/L/LRT/LRLL `projects` row).
-- Reverse matching (checking a new listing/lead against every Active
-- requirement) is the core design goal, not an afterthought — that's why
-- the fields below are structured rather than a single free-text blob, and
-- why `properties` gains `market_status` in this same migration: off-market
-- intel needs to be matchable against requirements the same way on-market
-- listings are, without a separate table.

-- ---------------------------------------------------------------------------
-- Requirements
-- ---------------------------------------------------------------------------
create table requirements (
  id uuid primary key default gen_random_uuid(),
  display_code text unique, -- REQ-0001
  deal_type text, -- Lease / Buy / Sell / Build-to-suit / 1031 Exchange — freeform, no DB enum (matches activity_type's philosophy: Dan adds new ones as they come up)
  property_type text, -- Office / Industrial / Retail / Multifamily / Land / Flex / Hospitality — matches properties.property_type's domain
  size_min numeric,
  size_max numeric,
  budget_min numeric,
  budget_max numeric,
  target_location text, -- freeform trade area / submarket, not a zip
  timeline text, -- freeform, e.g. "next 6 months", "Q1 2027"
  status text not null default 'active'
    check (status in ('active', 'on_hold', 'fulfilled', 'dead')),
  -- Deliberately a small starting set per the design decision — more statuses
  -- get added later as needed; that's a one-line constraint change, not a
  -- redesign (same pattern as projects.status).
  priority text default 'medium', -- High / Medium / Low — freeform, no DB enum
  details text, -- free text: what they actually said they need
  source text, -- referral / cold_call / networking / inbound — freeform, feeds visibility into what's generating new business
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_requirements_status on requirements(status);
create index idx_requirements_property_type on requirements(property_type);

alter table requirements enable row level security;

-- ---------------------------------------------------------------------------
-- Requirement <-> Party link — a single Requirement can attach to any
-- combination of contacts and entities at once (e.g. a decision-maker
-- personally AND the company itself), so this is a join table rather than a
-- single owner column on requirements.
-- ---------------------------------------------------------------------------
create table requirement_parties (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references requirements(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  entity_id uuid references entities(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint requirement_parties_contact_or_entity
    check (contact_id is not null or entity_id is not null)
);

create index idx_requirement_parties_requirement on requirement_parties(requirement_id);
create index idx_requirement_parties_contact on requirement_parties(contact_id);
create index idx_requirement_parties_entity on requirement_parties(entity_id);

alter table requirement_parties enable row level security;

-- ---------------------------------------------------------------------------
-- Projects: a Requirement can spawn zero, one, or several Projects over time
-- as different opportunities are pursued against the same underlying need.
-- Nullable and decoupled on purpose — a Requirement can sit open indefinitely
-- without ever becoming a formal Project.
-- ---------------------------------------------------------------------------
alter table projects
  add column requirement_id uuid references requirements(id) on delete set null;

create index idx_projects_requirement on projects(requirement_id);

-- ---------------------------------------------------------------------------
-- Properties: market_status lets off-market intel live in the same table as
-- on-market listings, so one property record feeds both normal listing
-- workflows and requirement-matching. Existing rows default to off_market;
-- update the ones that are actually active listings (e.g. CL-3606 S 61st Ave
-- Cir's marketed suite) by hand after this migration runs.
-- ---------------------------------------------------------------------------
alter table properties
  add column market_status text default 'off_market'
    check (market_status in ('on_market', 'off_market', 'sold', 'leased'));

create index idx_properties_market_status on properties(market_status);
