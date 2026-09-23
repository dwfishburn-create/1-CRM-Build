-- Dan Fishburn CRM — v1 schema, migration 015
-- Owner signals — what a property's owner has indicated they'd accept.
-- See CRM_Requirements_and_Decisions_Log.md, "9/15/2026 — Owner signals get
-- their own history table (owner_signals, migration 015 — renumbered 9/23/2026; 014 was already taken by the uncommitted contact lookup/merge migration)".
--
-- Design decisions baked in here (full reasoning in the decisions log):
--   * NOT a Requirement. requirements are demand ("find this for me") and
--     that table has no property link at all, so an owner's number would
--     float free of the building it's about. If an owner goes further and
--     asks Dan to find a buyer, that's an engagement (a project), not a
--     signal.
--   * NOT properties.market_status. How a property is marketed and what its
--     owner would accept are independent facts — a listed property can carry
--     a private "real number," an unlisted one can carry no signal at all.
--     Folding them together would make both unqueryable.
--   * A history table, not columns on properties. Owners' numbers move, and
--     the movement is negotiating leverage. A new conversation is a NEW ROW;
--     an old signal is never overwritten — the same no-overwrite pattern
--     leases uses for renewals. The current signal is the newest signal_date.
--     The deciding argument over notes/activity_log entries: off-market
--     candidates are rare, but owner price indications come up constantly in
--     owner prospecting, and only a table makes "which owners have signaled a
--     sale under $2M" a query.
--   * contact_id and entity_id are both optional and INDEPENDENT — who said
--     it and which owner entity it's about are different facts, and either
--     can be known without the other.
--   * signal_type and source are free text, NOT DB enums — same no-DB-enum
--     philosophy used everywhere else in this schema (activity_type,
--     project_type, market_status, event_type). Starting vocabulary enforced
--     by convention only, in the Agent API / MCP tool descriptions:
--       signal_type: Would Sell, Would Lease, Would Sell or Lease,
--                    Not Interested, Other
--       source:      Direct Conversation, Secondhand, Inferred
--     "Inferred" exists so a read-between-the-lines signal stays
--     distinguishable from something the owner actually said.
--   * indicated_rent_basis is free text alongside indicated_rent — owners
--     quote rent every possible way (PSF annual, PSF monthly, flat monthly,
--     "same as the last guy"), and a stated unit beats an assumed one.
--   * RLS on with no policies and no updated_at trigger, matching migration
--     012. Server-side access goes through the Supabase secret key.
--
-- CONFIDENTIAL BY DEFAULT — owner signals are never client-facing unless Dan
-- says so explicitly. Do not surface these on a client map, survey or report.

-- ---------------------------------------------------------------------------
-- Owner signals — dated indications of what an owner would accept on a
-- property. One row per conversation; never updated in place except to
-- correct a mistake.
-- ---------------------------------------------------------------------------
create table owner_signals (
  id uuid primary key default gen_random_uuid(),
  display_code text unique, -- SIG-0001
  property_id uuid not null references properties(id) on delete cascade,

  contact_id uuid references contacts(id) on delete set null, -- who said it
  entity_id uuid references entities(id) on delete set null,  -- the owner entity

  signal_date date not null default current_date,
  signal_type text not null, -- free text; see suggested vocabulary above
  source text,               -- free text: Direct Conversation, Secondhand, Inferred

  indicated_price numeric,       -- what they'd sell for
  indicated_rent numeric,        -- what they'd lease for
  indicated_rent_basis text,     -- free text: the unit the rent was quoted in

  conditions text, -- strings attached: timing, leaseback, 1031, keep the sign, etc.
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_owner_signals_property on owner_signals(property_id);
create index idx_owner_signals_contact on owner_signals(contact_id);
create index idx_owner_signals_entity on owner_signals(entity_id);
create index idx_owner_signals_signal_date on owner_signals(signal_date);
create index idx_owner_signals_signal_type on owner_signals(signal_type);

alter table owner_signals enable row level security;
