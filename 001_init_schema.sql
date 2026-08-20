-- Dan Fishburn CRM — v1 schema (Phase 1: Foundation)
-- Mirrors the six-tab Property_Ownership_Tracker.xlsx prototype, extended with
-- Companies, Projects, Sale/Lease Comps, and Tasks per the CRM Requirements &
-- Decisions Log (/1-CRM Build/CRM_Requirements_and_Decisions_Log.md).
--
-- Design notes:
--   * Human-readable display codes (PROP-0001, OWN-0001, etc.) are kept as a
--     separate indexed text column, NOT the primary key. Primary keys are
--     uuids, which play nicer with Supabase/Postgres tooling and RLS. The
--     display code convention from the Excel tracker is preserved for the UI.
--   * All tables have created_at/updated_at for audit trail purposes (ties
--     into the "Property Timeline" idea in the log).
--   * RLS is enabled on every table. For v1, all reads/writes happen through
--     server-side code using the Supabase secret key (which bypasses RLS),
--     since this is a single-user internal tool. No policies are added for
--     the publishable/anon key yet — that key is unused by the app for now.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Companies
-- ---------------------------------------------------------------------------
create table companies (
  id uuid primary key default gen_random_uuid(),
  display_code text unique,
  name text not null,
  industry text,
  website text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
create table contacts (
  id uuid primary key default gen_random_uuid(),
  display_code text unique, -- CON-0001 style, from the Excel tracker
  first_name text,
  last_name text,
  email text,
  phone text,
  mobile_phone text,
  title text,
  company_id uuid references companies(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Owners / Entities (LLCs, trusts, individuals)
-- ---------------------------------------------------------------------------
create table owners (
  id uuid primary key default gen_random_uuid(),
  display_code text unique, -- OWN-0001
  name text not null,
  entity_type text, -- Individual / LLC / Trust / Partnership / Corporation / Other
  primary_contact_id uuid references contacts(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Properties
-- ---------------------------------------------------------------------------
create table properties (
  id uuid primary key default gen_random_uuid(),
  display_code text unique, -- PROP-0001
  address text not null,
  city text,
  state text default 'NE',
  zip text,
  county text,
  parcel_number text, -- APN
  property_type text, -- Office / Industrial / Retail / Multifamily / Land / Flex / Hospitality
  building_sf numeric,
  land_acres numeric,
  year_built integer,
  submarket text, -- e.g. "Central Omaha", "West Dodge Corridor" — trade area, not zip
  latitude double precision,
  longitude double precision,
  research_status text default 'unresearched' check (research_status in ('unresearched','partial','confirmed')),
  -- unresearched = no marker, partial = yellow diamond, confirmed = green diamond
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_properties_research_status on properties(research_status);
create index idx_properties_property_type on properties(property_type);

-- ---------------------------------------------------------------------------
-- Property <-> Owner link (many-to-many with ownership history)
-- ---------------------------------------------------------------------------
create table property_owner (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  owner_id uuid not null references owners(id) on delete cascade,
  ownership_start_date date,
  ownership_end_date date, -- null = current owner
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_property_owner_property on property_owner(property_id);
create index idx_property_owner_owner on property_owner(owner_id);

-- ---------------------------------------------------------------------------
-- Projects (assignments) — engagement taxonomy from
-- New_Project_Setup_and_Categorization_-_SOP.md: TR, BR, CL, CS, L, LRT, LRLL
-- ---------------------------------------------------------------------------
create table projects (
  id uuid primary key default gen_random_uuid(),
  project_code text unique not null, -- e.g. TR-2026-001
  project_type text not null, -- TR / BR / CL / CS / L / LRT / LRLL
  client_name text not null,
  property_id uuid references properties(id) on delete set null,
  status text default 'active' check (status in ('active','on_hold','closed_won','closed_lost')),
  start_date date,
  target_close_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Activity Log — the largest, most valuable table (calls, emails, meetings,
-- tours, postcards, QR scans, CBRE-colleague updates, etc.)
-- ---------------------------------------------------------------------------
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  display_code text unique, -- LOG-0001
  property_id uuid references properties(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  owner_id uuid references owners(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  activity_type text not null, -- call / email / meeting / tour / postcard_sent / qr_scan / note / document
  activity_date timestamptz not null default now(),
  performed_by text, -- Dan, or a CBRE colleague's name (for the "CC Dan" workflow)
  summary text,
  next_step text,
  next_step_due_date date,
  client_visible boolean not null default false, -- controls monthly client-report inclusion
  source text, -- manual / email_import / postcard_engine / etc.
  created_at timestamptz not null default now()
);

create index idx_activity_log_property on activity_log(property_id);
create index idx_activity_log_project on activity_log(project_id);
create index idx_activity_log_owner on activity_log(owner_id);
create index idx_activity_log_date on activity_log(activity_date desc);

-- ---------------------------------------------------------------------------
-- Tasks / follow-ups
-- ---------------------------------------------------------------------------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  due_date date,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  property_id uuid references properties(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  owner_id uuid references owners(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_tasks_status_due on tasks(status, due_date);

-- ---------------------------------------------------------------------------
-- Sale Comps (manual entry, per decision log)
-- ---------------------------------------------------------------------------
create table sale_comps (
  id uuid primary key default gen_random_uuid(),
  property_address text not null,
  property_id uuid references properties(id) on delete set null, -- optional link if already in DB
  sale_date date,
  sale_price numeric,
  buyer text,
  seller text,
  building_sf numeric,
  land_acres numeric,
  price_per_sf numeric generated always as (
    case when building_sf is not null and building_sf > 0
      then round(sale_price / building_sf, 2)
      else null end
  ) stored,
  cap_rate numeric,
  property_type text,
  confidence_level text default 'broker_reported'
    check (confidence_level in ('confirmed','broker_reported','market_estimate','rumor')),
  why_it_matters text, -- free-text judgment field per the log's "Why this comp matters" idea
  notes text,
  source text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Lease Comps (manual entry, per decision log)
-- ---------------------------------------------------------------------------
create table lease_comps (
  id uuid primary key default gen_random_uuid(),
  property_address text not null,
  property_id uuid references properties(id) on delete set null,
  tenant text,
  landlord text,
  lease_date date,
  sf numeric,
  asking_rent numeric,
  final_rent numeric,
  lease_term_months integer,
  ti_allowance numeric,
  free_rent_months numeric,
  property_type text,
  confidence_level text default 'broker_reported'
    check (confidence_level in ('confirmed','broker_reported','market_estimate','rumor')),
  why_it_matters text,
  notes text,
  source text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security — enabled on everything. No client-side (publishable
-- key) policies yet; all access goes through server-side code using the
-- secret key, which bypasses RLS. Add policies here if/when direct
-- browser access is ever needed.
-- ---------------------------------------------------------------------------
alter table companies enable row level security;
alter table contacts enable row level security;
alter table owners enable row level security;
alter table properties enable row level security;
alter table property_owner enable row level security;
alter table projects enable row level security;
alter table activity_log enable row level security;
alter table tasks enable row level security;
alter table sale_comps enable row level security;
alter table lease_comps enable row level security;
