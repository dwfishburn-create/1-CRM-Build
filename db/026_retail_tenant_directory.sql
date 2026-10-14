-- Dan Fishburn CRM — v1 schema, migration 026
-- Retail Tenant Directory — the base directory (Build step 1 of 2).
--
-- Decisions this implements (decisions log):
--   9/22/2026  (second pass) Retail Tenant Directory, Dan's call: brands are
--              `entities` plus brand-level fields (category, size range,
--              frontage / drive-thru needs, target markets, metro locations,
--              expansion status); expansion plans are `requirements`;
--              contacts linked by role (real estate director, franchisee, the
--              brand's tenant rep broker). Requirements captured from vague
--              signals need timing, confidence, source and a re-confirm date
--              so they surface on the Dashboard instead of going stale.
--   9/22/2026  (third pass) Contacts link to companies with job history —
--              dates and a current/former flag.
--   9/16/2026  The vocabulary test: when a vocabulary is naturally closed,
--              constrain it. Category, facility type, expansion status,
--              drive-thru and target market are closed; site criteria stay
--              free text.
--   10/13/2026 Seed scope (Dan): everything from the two RealNex retail
--              groups, flagged unverified. Target markets (Dan's four
--              territories): Omaha Metro, Lincoln, Greater Nebraska,
--              Council Bluffs / Western Iowa.
--
-- Shape: a brand is an ordinary `entities` row plus ONE `retail_brands` row.
-- The profile is a 1:1 side table rather than columns on `entities`, because
-- most entities are owner LLCs, title companies and brokerages that will never
-- carry a category or a size range — and "is this company in the directory?"
-- becomes "does it have a retail_brands row?", which is also the unit the
-- shared colleague copy (10/13/2026, build step 2) will publish.
--
-- Metro locations are DERIVED (property_tenant + current leases), never typed,
-- per the "derive, don't declare" principle — see view retail_brand_directory.
--
-- Parts:
--   0. next_display_code — fix the 4-digit truncation found 10/13/2026
--   1. retail_categories — the category pick list (data, extendable)
--   2. retail_brands — the brand profile
--   3. requirements — confidence, source date, re-confirm date, markets
--   4. contact_entities — job history (is_current, started_on, ended_on)
--   5. view retail_brand_directory — one row per brand with derived counts
--
-- Run with "Run without RLS" (contains PL/pgSQL), then:
--   notify pgrst, 'reload schema';

begin;

-- ---------------------------------------------------------------------------
-- 0. next_display_code (021): lpad(n, 4) TRUNCATES past 9999 — CON-10000
-- would come out as CON-1000 and collide. The RealNex contact import (26,156
-- rows) will cross 9,999, so the format becomes "at least four digits".
-- Same body otherwise.
-- ---------------------------------------------------------------------------
create or replace function next_display_code(p_table text, p_prefix text)
returns text
language plpgsql
set search_path = public
as $fn$
declare
  v_next integer;
begin
  insert into display_code_counters (prefix, last_value)
  values (p_prefix, max_display_code_number(p_table, p_prefix))
  on conflict (prefix) do nothing;

  update display_code_counters
     set last_value = greatest(last_value, max_display_code_number(p_table, p_prefix)) + 1,
         updated_at = now()
   where prefix = p_prefix
  returning last_value into v_next;

  return p_prefix || '-' || case when v_next < 10000 then lpad(v_next::text, 4, '0') else v_next::text end;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 1. retail_categories
-- ---------------------------------------------------------------------------
create table if not exists retail_categories (
  code text primary key,
  label text not null unique,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table retail_categories enable row level security;

insert into retail_categories (code, label, sort_order) values
  ('restaurant_full_service', 'Restaurant — Full Service / Bar', 10),
  ('restaurant_casual',       'Restaurant — Casual / Family', 11),
  ('restaurant_fast_casual',  'Restaurant — Fast Casual', 12),
  ('restaurant_qsr',          'Restaurant — Fast Food / QSR', 13),
  ('coffee_bakery_dessert',   'Coffee, Bakery, Dessert & Specialty Food', 14),
  ('grocery',                 'Grocery & Specialty Grocery', 20),
  ('convenience_fuel',        'Convenience & Fuel', 21),
  ('pharmacy',                'Pharmacy & Drug', 22),
  ('apparel_shoes',           'Apparel & Shoes', 30),
  ('department_discount',     'Department, Discount & Variety', 31),
  ('home_furniture',          'Home, Furniture & Home Improvement', 32),
  ('electronics_wireless',    'Electronics & Wireless', 33),
  ('sporting_hobby',          'Sporting Goods, Hobby, Books & Music', 34),
  ('jewelry_accessories',     'Jewelry, Accessories & Gifts', 35),
  ('pet',                     'Pet', 36),
  ('beauty_salon_spa',        'Beauty, Salon & Spa', 40),
  ('fitness',                 'Fitness & Gym', 41),
  ('medical_dental',          'Medical, Dental & Wellness', 42),
  ('bank_financial',          'Bank & Financial Services', 50),
  ('auto',                    'Auto Parts, Service & Car Wash', 51),
  ('services',                'Services (shipping, cleaners, other)', 52),
  ('childcare_education',     'Childcare & Education', 53),
  ('entertainment',           'Entertainment & Family', 60),
  ('hotel',                   'Hotel & Lodging', 61),
  ('tobacco_vape_cannabis',   'Tobacco, Vape & CBD', 62),
  ('other',                   'Other', 999)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. retail_brands
-- ---------------------------------------------------------------------------
create table if not exists retail_brands (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null unique references entities(id) on delete cascade,

  category text references retail_categories(code) on update cascade,
  category_detail text,            -- the finer label as given, e.g. "Restaurant (w/ Liquor)"

  size_min_sf numeric,
  size_max_sf numeric,
  frontage_min_ft numeric,
  drive_thru text,                 -- required / preferred / no
  facility_types text[] not null default '{}',
  site_criteria text,              -- demographics, co-tenancy, corners — free text by design

  operating_model text,            -- corporate / franchise / both
  expansion_status text not null default 'unknown',
  target_markets text[] not null default '{}',

  needs_verification boolean not null default true,
  last_verified_on date,
  verification_note text,
  notes text,

  source_system text,
  source_record_id text,
  source_batch_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint retail_brands_size_check
    check (size_min_sf is null or size_max_sf is null or size_min_sf <= size_max_sf),
  constraint retail_brands_drive_thru_check
    check (drive_thru is null or drive_thru in ('required', 'preferred', 'no')),
  constraint retail_brands_operating_model_check
    check (operating_model is null or operating_model in ('corporate', 'franchise', 'both')),
  constraint retail_brands_expansion_status_check
    check (expansion_status in ('expanding', 'selective', 'not_expanding', 'contracting', 'unknown')),
  constraint retail_brands_facility_types_check
    check (facility_types <@ array[
      'free_standing', 'end_cap', 'neighborhood_strip', 'regional_strip',
      'power_center', 'lifestyle_center', 'regional_mall', 'outlet_mall',
      'downtown', 'kiosk'
    ]::text[]),
  constraint retail_brands_target_markets_check
    check (target_markets <@ array[
      'omaha_metro', 'lincoln', 'greater_nebraska', 'cb_western_iowa'
    ]::text[])
);

create index if not exists idx_retail_brands_category on retail_brands(category);
create index if not exists idx_retail_brands_expansion on retail_brands(expansion_status);
create index if not exists idx_retail_brands_markets on retail_brands using gin (target_markets);
create unique index if not exists idx_retail_brands_source_record
  on retail_brands (source_system, source_record_id) where source_record_id is not null;
create index if not exists idx_retail_brands_source_batch
  on retail_brands (source_batch_id) where source_batch_id is not null;

alter table retail_brands enable row level security;

-- updated_at moves on every update (the older tables still don't — see the
-- 9/25 open item; new tables do it right from the start).
create or replace function retail_brands_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists trg_retail_brands_touch on retail_brands;
create trigger trg_retail_brands_touch
  before update on retail_brands
  for each row execute function retail_brands_touch();

-- ---------------------------------------------------------------------------
-- 3. requirements — the expansion-signal fields
-- ---------------------------------------------------------------------------
alter table requirements
  add column if not exists confidence text,
  add column if not exists source_date date,
  add column if not exists reconfirm_date date,
  add column if not exists target_markets text[] not null default '{}';

alter table requirements drop constraint if exists requirements_confidence_check;
alter table requirements add constraint requirements_confidence_check
  check (confidence is null or confidence in ('high', 'medium', 'low'));

alter table requirements drop constraint if exists requirements_target_markets_check;
alter table requirements add constraint requirements_target_markets_check
  check (target_markets <@ array[
    'omaha_metro', 'lincoln', 'greater_nebraska', 'cb_western_iowa'
  ]::text[]);

create index if not exists idx_requirements_reconfirm
  on requirements(reconfirm_date) where reconfirm_date is not null;

-- ---------------------------------------------------------------------------
-- 4. contact_entities — job history
-- ---------------------------------------------------------------------------
alter table contact_entities
  add column if not exists is_current boolean not null default true,
  add column if not exists started_on date,
  add column if not exists ended_on date,
  add column if not exists source_system text,
  add column if not exists source_record_id text,
  add column if not exists source_batch_id text;

create index if not exists idx_contact_entities_source_batch
  on contact_entities (source_batch_id) where source_batch_id is not null;

-- ---------------------------------------------------------------------------
-- 4b. merge_entities must carry the brand profile across.
--
-- merge_entities (016) deletes the merged-away entity at the end, and
-- retail_brands.entity_id cascades — so without this, merging a duplicate
-- brand would silently delete its profile. Rather than copy the whole 016
-- function (logic in two places drifts — the 017 lesson), the 016 body is
-- renamed and wrapped: fold the brand profile first, then run it unchanged.
--
-- Fold rule (same as the 014/016 contract): the survivor's populated fields
-- win; a blank survivor field takes the loser's value; array fields are
-- unioned; notes are appended with provenance; the profile stays unverified
-- if either side was.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'merge_entities_016') then
    alter function merge_entities(uuid, uuid) rename to merge_entities_016;
  end if;
end
$$;

create or replace function merge_entities(p_keep_id uuid, p_merge_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  k retail_brands%rowtype;
  m retail_brands%rowtype;
  v_brand text := 'none';
  v_result jsonb;
begin
  select * into m from retail_brands where entity_id = p_merge_id;
  if found then
    select * into k from retail_brands where entity_id = p_keep_id;
    if not found then
      update retail_brands set entity_id = p_keep_id where id = m.id;
      v_brand := 'moved';
    else
      update retail_brands set
        category          = coalesce(k.category, m.category),
        category_detail   = coalesce(k.category_detail, m.category_detail),
        size_min_sf       = coalesce(k.size_min_sf, m.size_min_sf),
        size_max_sf       = coalesce(k.size_max_sf, m.size_max_sf),
        frontage_min_ft   = coalesce(k.frontage_min_ft, m.frontage_min_ft),
        drive_thru        = coalesce(k.drive_thru, m.drive_thru),
        facility_types    = array(select distinct unnest(k.facility_types || m.facility_types)),
        site_criteria     = coalesce(k.site_criteria, m.site_criteria),
        operating_model   = coalesce(k.operating_model, m.operating_model),
        expansion_status  = case when k.expansion_status = 'unknown' then m.expansion_status
                                 else k.expansion_status end,
        target_markets    = array(select distinct unnest(k.target_markets || m.target_markets)),
        needs_verification = k.needs_verification or m.needs_verification,
        last_verified_on  = greatest(k.last_verified_on, m.last_verified_on),
        notes = case
          when coalesce(btrim(m.notes), '') = '' then k.notes
          else concat_ws(E'\n\n', k.notes,
                 '[merged from brand profile of ' || p_merge_id::text || ', ' || current_date || '] ' || m.notes)
        end
      where id = k.id;
      delete from retail_brands where id = m.id;
      v_brand := 'folded';
    end if;
  end if;

  v_result := merge_entities_016(p_keep_id, p_merge_id);
  return v_result || jsonb_build_object('retail_brand', v_brand);
end
$$;

-- ---------------------------------------------------------------------------
-- 5. retail_brand_directory — the list screen and the Excel export read this
-- ---------------------------------------------------------------------------
drop view if exists retail_brand_directory;
create view retail_brand_directory as
select
  rb.id                as brand_id,
  e.id                 as entity_id,
  e.display_code,
  e.name,
  e.trade_name,
  e.website,
  rb.category,
  rc.label             as category_label,
  rb.category_detail,
  rb.size_min_sf,
  rb.size_max_sf,
  rb.frontage_min_ft,
  rb.drive_thru,
  rb.facility_types,
  rb.site_criteria,
  rb.operating_model,
  rb.expansion_status,
  rb.target_markets,
  rb.needs_verification,
  rb.last_verified_on,
  rb.verification_note,
  rb.notes,
  rb.source_system,
  rb.source_batch_id,
  rb.updated_at,
  -- People at the brand: the job-history link (current only) plus anyone whose
  -- primary company is the brand and who has no former-link saying otherwise.
  (select count(distinct x.contact_id) from (
      select ce.contact_id from contact_entities ce
       where ce.entity_id = e.id and ce.is_current
      union
      select c.id from contacts c
       where c.entity_id = e.id
         and not exists (select 1 from contact_entities f
                          where f.contact_id = c.id and f.entity_id = e.id
                            and not f.is_current)
    ) x)                                                                as current_contacts,
  -- Locations in Dan's markets: properties where the brand is a current tenant,
  -- from either the tenancy link or a current lease on one of its spaces.
  (select count(distinct x.property_id) from (
      select pt.property_id from property_tenant pt
       where pt.entity_id = e.id and pt.is_current
      union
      select s.property_id from leases l join spaces s on s.id = l.space_id
       where l.tenant_entity_id = e.id and l.is_current
    ) x)                                                                as metro_locations,
  (select count(*) from requirement_parties rp
     join requirements r on r.id = rp.requirement_id
    where rp.entity_id = e.id and r.status = 'active')                  as active_requirements,
  (select min(r.reconfirm_date) from requirement_parties rp
     join requirements r on r.id = rp.requirement_id
    where rp.entity_id = e.id and r.status = 'active')                  as next_reconfirm
from retail_brands rb
join entities e on e.id = rb.entity_id
left join retail_categories rc on rc.code = rb.category;

commit;
