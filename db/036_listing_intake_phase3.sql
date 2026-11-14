-- Dan Fishburn CRM — migration 036
-- Retail Listing Intake & Matching, Phase 3 (Dan, 11/14/2026: "do it").
--
--   1. listing_price_history — one row per observation of a listing's terms
--      (new listing, price change, under contract, sold, withdrawn...). Feeds
--      the map card / property page price line now, and Phase 6 (list-to-sale
--      ratio, days on market) later.
--   2. listing_price_summary (view) — latest observation per property +
--      listing type, with the first-seen date, the prior asking price and the
--      change since first listed.
--   3. entities.do_not_solicit / represented_by — structured version of the
--      11/14 rule: an owner represented by a CBRE colleague gets no
--      owner-outreach tasks from intake (first case: Triantafillou / Obermeyers).
--   4. listing_intake_backlog (view) — on-market and Dan-listing properties
--      still missing price history, an owner link, a photo or coordinates;
--      the scheduled sweep works through it a few at a time.

create table if not exists listing_price_history (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  listing_type text not null default 'sale'
    check (listing_type in ('sale', 'lease', 'sublease', 'land')),
  status text not null default 'active'
    check (status in ('active', 'price_change', 'under_contract', 'sold', 'leased', 'withdrawn', 'expired', 'relisted')),
  asking_price numeric,          -- sale/land: total asking price ($)
  asking_rate numeric,           -- lease/sublease: asking rate ($/SF/yr unless rate_basis says otherwise)
  rate_basis text,               -- e.g. 'NNN', 'MG', 'Gross', '$/mo'
  sf numeric,                    -- SF offered in this listing (space or building)
  listing_broker text,           -- names as printed on the flyer
  listing_firm text,
  is_cbre boolean not null default false,
  is_dan_listing boolean not null default false,
  observed_on date not null default current_date,
  source text,                   -- flyer | om | costar | web | dan | other
  source_ref text,               -- Dropbox path / URL / CoStar id
  notes text,
  source_system text,
  source_batch_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_lph_property on listing_price_history(property_id, observed_on desc);
create index if not exists idx_lph_observed on listing_price_history(observed_on desc);

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
       observations, source, source_ref
from ranked
where rn = 1;

alter table entities
  add column if not exists do_not_solicit boolean not null default false,
  add column if not exists represented_by text;

comment on column entities.do_not_solicit is
  'True = no owner-outreach tasks from intake/matching (e.g. represented by a CBRE colleague). See represented_by.';

create or replace view listing_intake_backlog with (security_invoker = true) as
with dan_listings as (
  select distinct pp.property_id
  from project_properties pp
  join projects pr on pr.id = pp.project_id
  where coalesce(pr.status, 'active') in ('active', 'on_hold')
    and upper(pr.project_type) ~ '(^|[^A-Z])(L|SL|CL|CS)([^A-Z]|$)'
)
select p.id as property_id, p.display_code, p.address, p.city, p.state,
       p.property_type, p.building_sf, p.market_status, p.research_status,
       (dl.property_id is not null) as is_dan_listing,
       not exists (select 1 from listing_price_history h where h.property_id = p.id) as needs_price,
       not exists (select 1 from property_owner po where po.property_id = p.id and coalesce(po.is_current, true)) as needs_owner,
       (p.photo_url is null) as needs_photo,
       (p.latitude is null or p.longitude is null) as needs_geocode,
       p.created_at
from properties p
left join dan_listings dl on dl.property_id = p.id
where (p.market_status = 'on_market' or dl.property_id is not null)
  and p.parent_property_id is null
  and (
    not exists (select 1 from listing_price_history h where h.property_id = p.id)
    or not exists (select 1 from property_owner po where po.property_id = p.id and coalesce(po.is_current, true))
    or p.photo_url is null
    or p.latitude is null or p.longitude is null
  );

-- Backfill: Wildcat (first live intake, 11/10/2026) and the 11/14 rule.
insert into listing_price_history (property_id, listing_type, status, asking_price, sf, listing_broker, listing_firm, is_cbre, observed_on, source, notes, source_system, source_batch_id)
select '4ea6d2f5-71e0-4d38-87b9-5f58c00ff46b', 'sale', 'active', 1700000, 2542, 'Amy Olson / Patrick Mulhall', null, false, date '2026-05-01', 'web',
       'Prior listing found by web search at intake; month approximate.', 'listing_intake', 'listing-intake-2026-11-10'
where exists (select 1 from properties where id = '4ea6d2f5-71e0-4d38-87b9-5f58c00ff46b')
  and not exists (select 1 from listing_price_history where property_id = '4ea6d2f5-71e0-4d38-87b9-5f58c00ff46b');
insert into listing_price_history (property_id, listing_type, status, asking_price, sf, listing_broker, listing_firm, is_cbre, observed_on, source, source_ref, source_system, source_batch_id)
select '4ea6d2f5-71e0-4d38-87b9-5f58c00ff46b', 'sale', 'relisted', 1490000, 2542, 'Mark Obermeyer / Austin Obermeyer', 'CBRE', true, date '2026-11-10', 'flyer',
       '/Prospecting/Listing Intake/02 - Processed/2026-11-10 - 6800 Wildcat Dr/6800_Wildcat_Dr_Lncln_Rtl_S_MO_AO_111026.pdf', 'listing_intake', 'listing-intake-2026-11-10'
where exists (select 1 from properties where id = '4ea6d2f5-71e0-4d38-87b9-5f58c00ff46b')
  and (select count(*) from listing_price_history where property_id = '4ea6d2f5-71e0-4d38-87b9-5f58c00ff46b') = 1;

update entities
set do_not_solicit = true, represented_by = 'Mark & Austin Obermeyer (CBRE)'
where id = '4d11d9ff-2726-40f4-8703-e0ebdb1cc716';
