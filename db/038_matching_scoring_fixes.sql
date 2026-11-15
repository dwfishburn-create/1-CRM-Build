-- Dan Fishburn CRM — migration 038
-- Requirement Matching scoring fixes (11/14/2026, Dan: "OK do it").
--
-- One new column. The rest of the fix is in lib/requirementMatchCore.ts:
--   - both 11/14 "strong" guards confirmed by Dan (2+ criteria known; property
--     class and market can't be a miss);
--   - new: a requirement that states acres (acres_min/acres_max) needs acres
--     KNOWN and MET to be strong — an unknown or missed site size keeps it a
--     near miss (no task) until acres are on the listing;
--   - new: requirements.outside_markets (below) lets a requirement say "my
--     market is outside Dan's four", so market scores as a MISS on every
--     property in Omaha / Lincoln / Greater NE / CB-Western IA instead of
--     being left blank and never counted (the REQ-0002 Wildcat false positive).
--
-- Why a separate boolean and not a fifth target_markets value: target_markets
-- is shared with the RTD (retail_brands, Share-to-RTD requirements) and its
-- four values are checked in migrations 026 and 029's rtd_* functions; a new
-- value there would make RTD edits of a shared requirement fail.
--
-- Run in the Supabase SQL editor (Run without RLS), then:
--   notify pgrst, 'reload schema';

alter table requirements
  add column if not exists outside_markets boolean not null default false;

comment on column requirements.outside_markets is
  'True when the party wants markets outside Dan''s four (e.g. Des Moines, national). Matching then scores market as a miss on any property in omaha_metro / lincoln / greater_nebraska / cb_western_iowa. Can be combined with target_markets.';

-- Backfill (Claude, 11/14 — from each record; Dan can change on the requirement page):
--   REQ-0002 Jaime — Des Moines / Kennewick
--   REQ-0004 M@C — national, West/South
update requirements
   set outside_markets = true
 where display_code in ('REQ-0002', 'REQ-0004')
   and coalesce(cardinality(target_markets), 0) = 0;

notify pgrst, 'reload schema';
