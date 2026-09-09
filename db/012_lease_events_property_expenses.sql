-- Dan Fishburn CRM — v1 schema, migration 012
-- Phase 2 of the Space/Lease data model (migration 011, Phase 1, 9/8/2026 —
-- see CRM_Requirements_and_Decisions_Log.md). Deliberately deferred until
-- Phase 1 was proven against real rent-roll data (The Shoppes at Lexington,
-- PROP-0024) — it has been, so this closes the two items parked at that
-- time: lease_events and property_expenses.
--
-- Design decisions baked in here (see decisions log for the full
-- discussion):
--   * lease_events is keyed to a lease, not a space or property directly —
--     every event (an option deadline, a rent bump, a TI disbursement) is a
--     fact about one specific lease term. The lease's own space_id/
--     property_id joins already answer "which property/space" when needed
--     (same embed pattern as the leases route itself).
--   * event_type is free text, NOT a DB enum — same no-DB-enum philosophy
--     used everywhere else in this schema (activity_type, project_type,
--     market_status, etc.). A starting vocabulary is enforced by convention
--     only, in the Agent API/MCP tool descriptions, not the database:
--       Lease Expiration, Option Notice Deadline, Option Exercise Deadline,
--       Renewal Rent Step, Scheduled Rent Bump, Rent Commencement,
--       TI Disbursement, CAM Reconciliation, Other
--   * event_date is nullable, mirroring leases.lease_end_date — real
--     rent-roll data already showed dates that aren't cleanly known yet
--     (Jasmine Nails' "Working on Renewal" from the Lexington load); a
--     not-yet-known date belongs in notes, not a guessed value.
--   * amount is a single generic numeric field (a rent-bump increase, a TI
--     disbursement dollar amount, etc.) rather than several narrowly-named
--     columns — keeps the table flexible across very different event
--     types, consistent with how lease terms themselves stay a handful of
--     generic numeric columns rather than one column per deal shape.
--   * is_completed tracks whether the event itself has happened/been
--     handled (notice sent, funds disbursed) — lightweight, independent of
--     the Tasks system. Whether/how lease_events should auto-create Tasks
--     or surface on the Dashboard is a separate, not-yet-built increment
--     (same "schema first, dashboard integration later" sequencing already
--     used for EV scoring on projects).
--
--   * property_expenses is intentionally minimal — property_id, year,
--     category, amount, per the original scope note in the decisions log
--     ("CAM/tax category breakout AND multi-year expense history in one
--     table, since both needs are the same shape of data"). category is
--     free text (CAM, Property Tax, Insurance, etc.), no DB enum, same
--     convention as everywhere else. No uniqueness constraint on
--     (property_id, year, category) — a category can get more than one row
--     in a year (e.g. a correction or a supplemental invoice) without
--     needing an upsert-then-adjust dance.

-- ---------------------------------------------------------------------------
-- Lease events — dated things tied to one specific lease: option/renewal
-- deadlines, scheduled rent bumps, rent commencement, TI disbursement, CAM
-- reconciliation, etc.
-- ---------------------------------------------------------------------------
create table lease_events (
  id uuid primary key default gen_random_uuid(),
  display_code text unique, -- EVENT-0001
  lease_id uuid not null references leases(id) on delete cascade,

  event_type text not null, -- free text; see suggested vocabulary above
  event_date date, -- null = not yet known/confirmed; use notes for context
  amount numeric, -- optional dollar amount relevant to the event (rent-bump increase, TI disbursement, etc.)

  is_completed boolean not null default false,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_lease_events_lease on lease_events(lease_id);
create index idx_lease_events_event_type on lease_events(event_type);
create index idx_lease_events_event_date on lease_events(event_date);
create index idx_lease_events_is_completed on lease_events(is_completed);

alter table lease_events enable row level security;

-- ---------------------------------------------------------------------------
-- Property expenses — CAM/tax/insurance category breakout, multi-year
-- expense history. One row per property/year/category (not enforced
-- unique — see note above).
-- ---------------------------------------------------------------------------
create table property_expenses (
  id uuid primary key default gen_random_uuid(),
  display_code text unique, -- EXP-0001
  property_id uuid not null references properties(id) on delete cascade,

  year integer not null,
  category text not null, -- free text: CAM, Property Tax, Insurance, etc.
  amount numeric not null,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_property_expenses_property on property_expenses(property_id);
create index idx_property_expenses_year on property_expenses(year);
create index idx_property_expenses_category on property_expenses(category);

alter table property_expenses enable row level security;
