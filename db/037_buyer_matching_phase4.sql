-- Dan Fishburn CRM — migration 037
-- Retail Listing Intake & Matching, Phase 4: buyer matching (11/14/2026).
-- Design: /1-CRM Build/Retail_Listing_Intake_and_Matching_-_Design.md §7 lane 1
-- and §9 prerequisite 1 + 9.
--
--   1. requirements gain structured matching criteria: which side the party
--      is on (tenant / buyer / investor / developer), normalized asset
--      classes (the free-text property_type stays as the description),
--      land acres, and investor criteria — min cap rate, tenancy types,
--      tenant credit floor, min remaining lease term, 1031 exchange dates.
--   2. listing_price_history gains the investment facts a flyer/OM carries
--      (cap rate, NOI, tenancy, tenant credit, remaining term, land acres),
--      so a sale listing can be scored against those criteria.
--   3. listing_price_summary is recreated with the new columns appended.
--   4. Backfill REQ-0001..REQ-0014 sides / asset classes / markets from what
--      each record already says (Claude, 11/14 — each line commented).
--
-- Scoring lives in lib/requirementMatch.ts (one place for the web pages, the
-- agent API and the connector). Rule (Dan, 11/10): strong match = 50%+ of the
-- requirement's stated criteria; blank criteria aren't counted; a criterion
-- the listing doesn't state is "unknown", not a miss.
--
-- Run in the Supabase SQL editor (Run without RLS), then:
--   notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 1. Requirements: structured criteria
-- ---------------------------------------------------------------------------
alter table requirements
  add column if not exists sides text[] not null default '{}',
  add column if not exists asset_classes text[] not null default '{}',
  add column if not exists acres_min numeric,
  add column if not exists acres_max numeric,
  add column if not exists cap_rate_min numeric,          -- percent, e.g. 6.5
  add column if not exists tenancy_types text[] not null default '{}',
  add column if not exists credit_floor text,
  add column if not exists min_term_years numeric,
  add column if not exists exchange_1031 boolean not null default false,
  add column if not exists exchange_identify_by date,
  add column if not exists exchange_close_by date;

alter table requirements drop constraint if exists requirements_sides_check;
alter table requirements add constraint requirements_sides_check
  check (sides <@ array['tenant', 'buyer', 'investor', 'developer']::text[]);

alter table requirements drop constraint if exists requirements_asset_classes_check;
alter table requirements add constraint requirements_asset_classes_check
  check (asset_classes <@ array['retail', 'industrial', 'flex', 'office', 'land',
                                'multifamily', 'hospitality', 'mixed_use', 'special_purpose']::text[]);

alter table requirements drop constraint if exists requirements_tenancy_types_check;
alter table requirements add constraint requirements_tenancy_types_check
  check (tenancy_types <@ array['single_tenant_nnn', 'multi_tenant', 'vacant', 'value_add',
                                'owner_user', 'ground_lease']::text[]);

alter table requirements drop constraint if exists requirements_credit_floor_check;
alter table requirements add constraint requirements_credit_floor_check
  check (credit_floor is null or credit_floor in ('investment_grade', 'national', 'regional', 'local'));

comment on column requirements.sides is
  'Which side of a deal the party is on: tenant / buyer (owner-user) / investor / developer. Drives which listings it is matched against.';
comment on column requirements.asset_classes is
  'Normalized property classes for matching. property_type stays as the free-text description.';
comment on column requirements.cap_rate_min is 'Minimum going-in cap rate, percent (6.5 = 6.5%).';
comment on column requirements.credit_floor is
  'Lowest tenant credit acceptable: investment_grade > national > regional > local.';

create index if not exists idx_requirements_sides on requirements using gin (sides);
create index if not exists idx_requirements_asset_classes on requirements using gin (asset_classes);

-- ---------------------------------------------------------------------------
-- 2. Listing observations: investment facts
-- ---------------------------------------------------------------------------
alter table listing_price_history
  add column if not exists cap_rate numeric,               -- percent
  add column if not exists noi numeric,                    -- $/yr
  add column if not exists tenancy_type text,
  add column if not exists tenant_credit text,
  add column if not exists term_remaining_years numeric,
  add column if not exists land_acres numeric;

alter table listing_price_history drop constraint if exists lph_tenancy_type_check;
alter table listing_price_history add constraint lph_tenancy_type_check
  check (tenancy_type is null or tenancy_type in ('single_tenant_nnn', 'multi_tenant', 'vacant',
                                                  'value_add', 'owner_user', 'ground_lease'));
alter table listing_price_history drop constraint if exists lph_tenant_credit_check;
alter table listing_price_history add constraint lph_tenant_credit_check
  check (tenant_credit is null or tenant_credit in ('investment_grade', 'national', 'regional', 'local'));

-- ---------------------------------------------------------------------------
-- 3. Summary view — same columns as 036, new ones appended at the end
--    (create or replace view can only add columns at the end).
-- ---------------------------------------------------------------------------
create or replace view listing_price_summary with (security_invoker = true) as
with ranked as (
  select h.*,
         row_number() over (partition by property_id, listing_type order by observed_on desc, created_at desc) as rn,
         min(observed_on) over (partition by property_id, listing_type) as first_seen_on,
         first_value(coalesce(asking_price, asking_rate)) over (
           partition by property_id, listing_type order by observed_on asc, created_at asc
         ) as first_ask,
         lead(coalesce(asking_price, asking_rate)) over (
           partition by property_id, listing_type order by observed_on desc, created_at desc
         ) as prior_ask,
         count(*) over (partition by property_id, listing_type) as observations
  from listing_price_history h
)
select property_id, listing_type, status, asking_price, asking_rate, rate_basis, sf,
       listing_broker, listing_firm, is_cbre, is_dan_listing,
       observed_on as last_observed_on, first_seen_on,
       (current_date - first_seen_on) as days_observed,
       first_ask, prior_ask,
       case when first_ask is not null and first_ask <> 0
            then round(((coalesce(asking_price, asking_rate) - first_ask) / first_ask) * 100, 1)
       end as pct_change_since_first,
       observations, source, source_ref,
       cap_rate, noi, tenancy_type, tenant_credit, term_remaining_years, land_acres
from ranked
where rn = 1;

-- ---------------------------------------------------------------------------
-- 4. Backfill existing requirements (Claude's reading of each record, 11/14;
--    Dan can change any of these on the requirement page). Only rows whose
--    new fields are still empty are touched, so a re-run never overwrites.
-- ---------------------------------------------------------------------------
update requirements r
set sides = b.sides::text[],
    asset_classes = b.classes::text[],
    target_markets = case when coalesce(cardinality(r.target_markets), 0) = 0 then b.markets::text[] else r.target_markets end,
    updated_at = now()
from (values
  ('REQ-0001', '{buyer}',              '{industrial,flex}', '{omaha_metro}'),   -- unnamed buyer via Kevin Stratman; South Central Omaha
  ('REQ-0002', '{tenant,buyer}',       '{retail}',          '{}'),              -- Jaime: Des Moines / Kennewick, outside Dan's four markets
  ('REQ-0003', '{tenant}',             '{retail}',          '{omaha_metro}'),   -- furniture sublease, 12977 W Center
  ('REQ-0004', '{tenant}',             '{industrial}',      '{}'),              -- M@C: national, not the Midwest
  ('REQ-0005', '{tenant}',             '{retail}',          '{lincoln}'),       -- indoor playground, 5040 N 27th
  ('REQ-0006', '{tenant,buyer}',       '{industrial,flex}', '{omaha_metro}'),   -- Master Grassmen (dead)
  ('REQ-0007', '{tenant}',             '{flex}',            '{omaha_metro}'),   -- Tom Maxwell
  ('REQ-0008', '{developer,investor}', '{land,multifamily,retail}', '{lincoln,omaha_metro}'), -- Sutton (on hold)
  ('REQ-0009', '{buyer}',              '{land,retail}',     '{omaha_metro}'),   -- bank branch pad, Coventry
  ('REQ-0010', '{tenant}',             '{flex}',            '{omaha_metro}'),   -- Tom storage
  ('REQ-0011', '{buyer}',              '{land,retail}',     '{omaha_metro}'),   -- 7 Brew pad
  ('REQ-0012', '{developer}',          '{land,retail}',     '{omaha_metro}'),   -- Valvoline / Aterra
  ('REQ-0013', '{buyer}',              '{land,retail}',     '{omaha_metro}'),   -- C-store land or existing C-store
  ('REQ-0014', '{tenant}',             '{retail}',          '{omaha_metro}')    -- Rosati's
) as b(code, sides, classes, markets)
where r.display_code = b.code
  and cardinality(r.sides) = 0
  and cardinality(r.asset_classes) = 0;

-- Pad sizes were stated in acres. REQ-0013's size_min/max held 1–2 ac as land
-- SF (43,560–87,120), which would score a 4,000 SF C-store building as a miss;
-- move it to acres. REQ-0012's Valvoline prototype pad is ~0.8–1.0 ac.
update requirements set acres_min = 1, acres_max = 2, size_min = null, size_max = null, updated_at = now()
where display_code = 'REQ-0013' and size_min = 43560 and size_max = 87120 and acres_min is null;
update requirements set acres_min = 0.8, acres_max = 1.0, updated_at = now()
where display_code = 'REQ-0012' and acres_min is null and acres_max is null;

notify pgrst, 'reload schema';
