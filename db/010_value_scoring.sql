-- Dan Fishburn CRM — v1 schema, migration 010
-- Value/Probability/Expected-Value scoring for projects, per the
-- 8/23/2026 design in CRM_Requirements_and_Decisions_Log.md — picked as
-- the next build item 9/2/2026 once the update_contact/update_property/
-- update_entity/update_project PATCH tools made per-field corrections
-- possible without raw SQL.
--
-- Two auto-calculated fields (deal_value, expected_value) plus one
-- deliberately manual field (strategic_weight_note). Per the 8/23/2026
-- decision: "deal value" (price x commission rate) computes automatically
-- from documents Dan pulls into a project as he sets it up; "strategic
-- weight" is a human judgment call (relationship leverage, repeat-business
-- likelihood) that is NEVER algorithmically inferred — only entered or
-- adjusted by Dan. Kept as a free-text note rather than a number so it
-- can't be mistaken for a second score, mirroring how the interim
-- Commission_Opportunity_Pipeline_Tracker.xlsx (8/28/2026) already keeps
-- its Strategic Weight note field separate from the auto-calculated
-- Expected Value column.
--
-- deal_value and expected_value are both generated columns — same
-- "computed columns are not source data" convention already used for
-- sale_comps.price_per_sf — expressed directly off the raw stored columns
-- rather than off each other, since Postgres does not allow a generated
-- column to reference another generated column.
--
-- All clauses use IF NOT EXISTS, per the lesson from the 8/25/2026 Tasks/
-- Dashboard migration (a non-idempotent multi-clause ALTER TABLE aborts
-- entirely on the first already-applied clause) — safe to re-run
-- regardless of what's already applied.

alter table projects
  add column if not exists deal_price numeric,
  -- sale price, or an annualized lease value Dan enters by hand for a
  -- lease deal — no separate sale-vs-lease flag, same as commission_rate
  -- already varying by deal with no DB enum
  add column if not exists commission_rate numeric,
  -- percent, e.g. 6 for 6% — Dan's gross commission rate on this deal
  add column if not exists probability_pct numeric,
  -- percent, 0-100 — Dan's own estimate of the deal actually closing;
  -- range is validated at the app/API layer, not a DB check constraint,
  -- matching how the rest of this schema handles numeric ranges
  add column if not exists strategic_weight_note text;
  -- manual-only judgment call, deliberately never computed — see above

alter table projects
  add column if not exists deal_value numeric
    generated always as (deal_price * commission_rate / 100) stored,
  add column if not exists expected_value numeric
    generated always as
      (deal_price * commission_rate / 100 * probability_pct / 100) stored;
