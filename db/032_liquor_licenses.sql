-- CRM - Dan Fishburn — migration 032: Nebraska liquor licenses (10/26/2026)
--
-- Dan, 10/26/2026: "I have a spreadsheet that contains contact information for
-- businesses that hold liquor licenses in the state of Nebraska. How/where
-- should we save this info and how do we have it available for the CRM?"
-- Then: "Let's do the CRM build and I also want this data available to the
-- RTD too." Choices (10/26): Nebraska retail + misc licenses only (no
-- out-of-state shippers); Jami and Trey get the full search + Excel export in
-- the RTD; exact name matches link to companies automatically, near matches go
-- to Dan as an Excel sheet.
--
-- Design (agreed in chat 10/26/2026):
--   * The NLCC roster is a REFERENCE DATASET, not CRM records. It lives in its
--     own table, refreshed from dated roster pulls. It never lands in contacts
--     or entities wholesale: a licensee becomes an entity / contact only when
--     Dan works it or it matches a record already on file ("promote when
--     touched"), through the ordinary create paths and their 016 gate.
--   * Every pull is a SNAPSHOT. Raw files stay in Dropbox
--     /Prospecting/Liquor Licenses/Raw/ (dated, never overwritten). Importing a
--     snapshot diffs it against what's on file: new licenses (openings),
--     dropped licenses (closures / coming vacancies), and changed licensee,
--     trade name, manager, class or address (a business sale, a re-brand, a
--     new manager) are recorded as liquor_license_changes rows.
--   * Two company links per license, because a franchisee is not the brand:
--       brand_entity_id    — the Retail Tenant Directory brand (by trade name)
--       licensee_entity_id — the operating company that holds the license
--     plus property_id (premises address matches a CRM property) and
--     contact_id (the manager, once promoted).
--   * Links are 'auto' (exact match, re-evaluated on every import), 'dan'
--     (set by Dan on that license — never overwritten by anything) or, for the
--     brand link only, 'dan_key' (from Dan's decision for the brand key).
--     Brand decisions are stored per brand key (the trade name without store
--     numbers), so one decision covers every Casey's, Applebee's ... in this
--     and every later snapshot.
--   * The RTD reads through rtd_liquor_* SECURITY DEFINER functions only (028
--     rule). They return the public-record roster fields plus the RTD brand a
--     license is linked to — never CRM-only links (properties, non-brand
--     companies, contacts) and never Dan's notes.
--
-- Class codes and labels: NLCC "Class Types" sheet
-- (lcc.nebraska.gov/sites/default/files/licensing/Class Types.pdf), 10/26/2026.
--
-- Parts:
--   1. liquor_license_classes — class pick list with a sale type
--   2. tables: snapshots, licenses, staging, history, changes, brand decisions
--   3. liquor_brand_key()
--   4. import: liquor_begin_snapshot / liquor_stage_rows / liquor_import_snapshot
--      / liquor_rollback_snapshot
--   5. linking: liquor_auto_link / liquor_brand_suggestions / liquor_decide_brand
--      / liquor_link_license
--   6. CRM reads: liquor_search / liquor_operators / liquor_changes / liquor_meta
--   7. RTD window: rtd_liquor_meta / rtd_liquor_search / rtd_liquor_operators /
--      rtd_brand_liquor
--   8. grants
--
-- Paste into the Supabase SQL editor and use "Run without RLS" (PL/pgSQL), then
--   notify pgrst, 'reload schema';
-- Re-runnable.

begin;

-- ===========================================================================
-- 1. Class pick list
-- ===========================================================================
create table if not exists liquor_license_classes (
  code       text primary key,
  label      text not null,
  sale_type  text not null check (sale_type in
               ('on_premise', 'off_premise', 'both', 'maker', 'wholesale', 'shipper', 'secondary', 'other')),
  sort_order int  not null default 100
);
alter table liquor_license_classes enable row level security;

insert into liquor_license_classes (code, label, sale_type, sort_order) values
  ('A',  'Beer only, on-premise',                                   'on_premise',  10),
  ('I',  'Beer, wine & spirits, on-premise',                        'on_premise',  11),
  ('C',  'Beer, wine & spirits, on- and off-premise',               'both',        20),
  ('AB', 'Beer, on- and off-premise',                               'both',        21),
  ('AD', 'Beer on-premise; beer & spirits off-premise',             'both',        22),
  ('IB', 'Beer, wine & spirits on-premise; beer off-premise',       'both',        23),
  ('ID', 'Alcoholic liquor, on- and off-premise',                   'both',        24),
  ('B',  'Beer only, off-premise',                                  'off_premise', 30),
  ('D',  'Beer, wine & spirits, off-premise',                       'off_premise', 31),
  ('J',  'Limited alcoholic liquor, off-premise',                   'off_premise', 32),
  ('L',  'Craft brewery',                                           'maker',       40),
  ('Y',  'Farm winery',                                             'maker',       41),
  ('Z',  'Micro distillery',                                        'maker',       42),
  ('V',  'Manufacturer of beer',                                    'maker',       43),
  ('VS', 'Manufacturer of alcohol & spirits',                       'maker',       44),
  ('VW', 'Manufacturer of wine',                                    'maker',       45),
  ('W',  'Wholesale beer',                                          'wholesale',   50),
  ('X',  'Wholesale liquor',                                        'wholesale',   51),
  ('S',  'Liquor shipper',                                          'shipper',     60),
  ('S1', 'Direct shipper',                                          'shipper',     61),
  ('T',  'Beer shipper',                                            'shipper',     62),
  ('M',  'Bottle club',                                             'other',       70),
  ('N',  'Non-beverage',                                            'other',       71),
  ('O',  'Boat',                                                    'other',       72),
  ('P',  'Airplane',                                                'other',       73),
  ('Q',  'Pedal pub',                                               'other',       74),
  ('R',  'Railroad',                                                'other',       75),
  ('U',  'Special party bus',                                       'other',       76),
  ('E',  'Entertainment district (secondary)',                      'secondary',   80),
  ('K',  'Catering (secondary)',                                    'secondary',   81),
  ('G',  'Growler (secondary)',                                     'secondary',   82),
  ('CS', 'Cigar shop (secondary)',                                  'secondary',   83)
on conflict (code) do update
  set label = excluded.label, sale_type = excluded.sale_type, sort_order = excluded.sort_order;

-- A roster can carry variants the class sheet doesn't list (S1R, N1..N5, Y1,
-- V4 ...). Exact code first, then the longest listed code it starts with.
create or replace function liquor_sale_type(p_class text)
returns text
language sql stable
set search_path = public
as $$
  select coalesce(
    (select sale_type from liquor_license_classes where code = upper(btrim(p_class))),
    (select sale_type from liquor_license_classes
      where upper(btrim(p_class)) like code || '%'
      order by length(code) desc limit 1),
    'other');
$$;

-- ===========================================================================
-- 2. Tables
-- ===========================================================================

-- One row per roster pull. batch_id is the provenance key (nlcc-YYYY-MM-DD).
create table if not exists liquor_license_snapshots (
  id             uuid primary key default gen_random_uuid(),
  batch_id       text not null unique,
  snapshot_date  date not null,
  source_file    text,
  note           text,
  created_at     timestamptz not null default now(),
  imported_at    timestamptz,
  is_baseline    boolean not null default false,
  staged_count   int not null default 0,
  row_count      int,
  new_count      int,
  dropped_count  int,
  returned_count int,
  changed_count  int
);
alter table liquor_license_snapshots enable row level security;

create table if not exists liquor_licenses (
  id                   uuid primary key default gen_random_uuid(),
  license_number       text not null unique,
  class_type           text,              -- NLCC "License Class Type": Retail / Miscellaneous / Shipper
  class                text,
  secondary_licenses   text[] not null default '{}',
  sale_type            text not null default 'other',
  trade_name           text,
  premises_street      text,
  premises_city        text,
  premises_state       text,
  premises_zip         text,
  county               text,
  county_index         text,
  corporate_limits     text,              -- Inside / Outside city limits
  restrictions         text,
  phone                text,
  email                text,
  manager_name         text,
  licensee             text,
  corporate_address    text,
  effective_date       date,
  issue_date           date,
  expiration_date      date,
  legal_description    text,
  status               text not null default 'active' check (status in ('active', 'dropped')),
  first_seen_snapshot_id uuid references liquor_license_snapshots(id),
  last_seen_snapshot_id  uuid references liquor_license_snapshots(id),
  first_seen_on        date,
  last_seen_on         date,
  dropped_on           date,
  brand_key            text,
  licensee_normalized  text,
  premises_normalized  text,
  brand_entity_id      uuid references entities(id) on delete set null,
  brand_link_source    text,   -- auto | dan (set on this license) | dan_key (Dan's brand-key decision)
  licensee_entity_id   uuid references entities(id) on delete set null,
  licensee_link_source text check (licensee_link_source in ('auto', 'dan')),
  property_id          uuid references properties(id) on delete set null,
  property_link_source text check (property_link_source in ('auto', 'dan')),
  contact_id           uuid references contacts(id) on delete set null,
  notes                text,              -- Dan's; never shown in the RTD
  source_system        text not null default 'nlcc',
  source_record_id     text,
  source_batch_id      text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table liquor_licenses enable row level security;

-- brand_link_source gained 'dan_key' in review (10/26/2026): a decision for a
-- brand key must never overwrite a link Dan set on one license by hand.
alter table liquor_licenses drop constraint if exists liquor_licenses_brand_link_source_check;
alter table liquor_licenses add constraint liquor_licenses_brand_link_source_check
  check (brand_link_source in ('auto', 'dan', 'dan_key'));

create index if not exists idx_liquor_licenses_status      on liquor_licenses (status);
create index if not exists idx_liquor_licenses_city        on liquor_licenses (lower(premises_city));
create index if not exists idx_liquor_licenses_county      on liquor_licenses (county);
create index if not exists idx_liquor_licenses_brand_key   on liquor_licenses (brand_key);
create index if not exists idx_liquor_licenses_licensee    on liquor_licenses (licensee_normalized);
create index if not exists idx_liquor_licenses_brand_ent   on liquor_licenses (brand_entity_id);
create index if not exists idx_liquor_licenses_lic_ent     on liquor_licenses (licensee_entity_id);
create index if not exists idx_liquor_licenses_property    on liquor_licenses (property_id);

-- Rows of a snapshot waiting to be imported. Filled in chunks
-- (liquor_stage_rows) so a 5,000-row roster fits the SQL editor; emptied by a
-- successful import.
create table if not exists liquor_license_staging (
  snapshot_id    uuid not null references liquor_license_snapshots(id) on delete cascade,
  license_number text not null,
  row            jsonb not null,
  primary key (snapshot_id, license_number)
);
alter table liquor_license_staging enable row level security;

-- Pre-image of every license a snapshot touched, so the latest snapshot can be
-- rolled back exactly.
create table if not exists liquor_license_history (
  id          uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references liquor_license_snapshots(id) on delete cascade,
  license_id  uuid not null references liquor_licenses(id) on delete cascade,
  prev        jsonb not null,
  unique (snapshot_id, license_id)
);
alter table liquor_license_history enable row level security;

-- The prospecting signal: what one roster pull says changed since the last.
create table if not exists liquor_license_changes (
  id          uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references liquor_license_snapshots(id) on delete cascade,
  license_id  uuid not null references liquor_licenses(id) on delete cascade,
  change_type text not null check (change_type in
                ('new', 'dropped', 'returned', 'licensee', 'trade_name', 'manager', 'class', 'address')),
  old_value   text,
  new_value   text,
  created_at  timestamptz not null default now()
);
alter table liquor_license_changes enable row level security;
create index if not exists idx_liquor_changes_snapshot on liquor_license_changes (snapshot_id, change_type);
create index if not exists idx_liquor_changes_license  on liquor_license_changes (license_id);

-- Dan's brand decisions, per brand key: link every license with this key to
-- entity_id, or (entity_id null) "not a match — don't suggest again".
create table if not exists liquor_brand_key_decisions (
  brand_key  text primary key,
  entity_id  uuid references entities(id) on delete cascade,
  decided_at timestamptz not null default now(),
  note       text
);
alter table liquor_brand_key_decisions enable row level security;

-- ===========================================================================
-- 3. Brand key — the trade name without store numbers, LLC/Inc and punctuation
--    "CASEY'S GENERAL STORE #2981" -> "caseys general store"
--    "PIZZA HUT OF NORFOLK 1"      -> "pizza hut norfolk"
--    "7-ELEVEN #35172"             -> "7 eleven"   (digits inside a name stay)
--    "EL MEXICANO 5"               -> "el mexicano" ("no" only as a word: "No. 5")
-- ===========================================================================
create or replace function liquor_brand_key(p_trade_name text)
returns text
language sql immutable
as $$
  select nullif(btrim(regexp_replace(
           normalize_entity_name(regexp_replace(coalesce(p_trade_name, ''), '(#\s*\d+\w*|\yno\.?\s*\d+\w*)', ' ', 'gi')),
           '\s\d+\s*$', '')), '');
$$;

-- Keys follow the function (re-running this migration after a change re-keys).
update liquor_licenses set brand_key = liquor_brand_key(trade_name)
 where brand_key is distinct from liquor_brand_key(trade_name);

-- ===========================================================================
-- 4. Import
-- ===========================================================================

-- Start a snapshot. Re-running with the same batch_id returns the existing
-- (not yet imported) snapshot so a half-staged paste can be finished.
drop function if exists liquor_begin_snapshot(text, date, text, text);
create or replace function liquor_begin_snapshot(
  p_batch_id text, p_snapshot_date date, p_source_file text default null, p_note text default null,
  p_reset boolean default false)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  s liquor_license_snapshots;
begin
  perform pg_advisory_xact_lock(hashtext('liquor_roster'));
  if coalesce(btrim(p_batch_id), '') = '' or p_snapshot_date is null then
    raise exception 'liquor_begin_snapshot: batch_id and snapshot_date are required';
  end if;
  select * into s from liquor_license_snapshots where batch_id = p_batch_id;
  if found then
    if s.imported_at is not null then
      raise exception 'Snapshot % was already imported on %', p_batch_id, s.imported_at;
    end if;
    -- An upload starts over: rows left by an upload that died mid-way must not
    -- merge into this one.
    if coalesce(p_reset, false) then
      delete from liquor_license_staging where snapshot_id = s.id;
      update liquor_license_snapshots set staged_count = 0, source_file = coalesce(p_source_file, source_file),
             note = coalesce(p_note, note) where id = s.id;
    end if;
    return s.id;
  end if;
  if exists (select 1 from liquor_license_snapshots
              where imported_at is not null and snapshot_date >= p_snapshot_date) then
    raise exception 'A roster dated % or later is already imported; snapshots go in date order', p_snapshot_date;
  end if;
  insert into liquor_license_snapshots (batch_id, snapshot_date, source_file, note)
  values (p_batch_id, p_snapshot_date, p_source_file, p_note)
  returning * into s;
  return s.id;
end
$$;

-- Add rows (a jsonb array of objects, one per license) to a snapshot.
-- Keys: license_number, class_type, class, secondary (array), trade_name,
-- premises_street, premises_city, premises_state, premises_zip, county,
-- county_index, corporate_limits, restrictions, phone, email, manager_name,
-- licensee, corporate_address, effective_date, issue_date, expiration_date,
-- legal_description. A license repeated in a later chunk replaces the earlier.
create or replace function liquor_stage_rows(p_batch_id text, p_rows jsonb)
returns int
language plpgsql
set search_path = public
as $$
declare
  s liquor_license_snapshots;
  n int;
begin
  select * into s from liquor_license_snapshots where batch_id = p_batch_id;
  if not found then raise exception 'No snapshot %; call liquor_begin_snapshot first', p_batch_id; end if;
  if s.imported_at is not null then raise exception 'Snapshot % is already imported', p_batch_id; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be a JSON array'; end if;

  insert into liquor_license_staging (snapshot_id, license_number, row)
  select s.id, btrim(r ->> 'license_number'), r
    from jsonb_array_elements(p_rows) r
   where coalesce(btrim(r ->> 'license_number'), '') <> ''
  on conflict (snapshot_id, license_number) do update set row = excluded.row;
  get diagnostics n = row_count;

  update liquor_license_snapshots
     set staged_count = (select count(*) from liquor_license_staging where snapshot_id = s.id)
   where id = s.id;
  return n;
end
$$;

-- Address signature for change detection: the normalised street's words in
-- sorted order plus the city, so "STE 110-1100 S DEWEY ST" and
-- "1100 S DEWEY ST STE 110" (the same suite, written two ways in two NLCC
-- pulls two weeks apart) are not reported as a move.
create or replace function liquor__addr_sig(p_street text, p_city text)
returns text
language sql immutable
as $$
  select coalesce((select string_agg(w, ' ' order by w)
                     from unnest(string_to_array(normalize_address(regexp_replace(coalesce(p_street, ''), '[-/]', ' ', 'g')), ' ')) w
                    where w <> ''), '')
         || '|' || lower(btrim(coalesce(p_city, '')));
$$;

-- Diff the staged roster against what's on file and apply it.
-- The first snapshot ever imported is the BASELINE: everything in it is simply
-- "on file" — no 'new' changes are recorded, since nothing is new relative to
-- a previous pull.
create or replace function liquor_import_snapshot(p_batch_id text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  s liquor_license_snapshots;
  v_baseline boolean;
  v_new int := 0; v_dropped int := 0; v_returned int := 0; v_changed int := 0; v_rows int;
  v_link jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('liquor_roster'));
  select * into s from liquor_license_snapshots where batch_id = p_batch_id for update;
  if not found then raise exception 'No snapshot %', p_batch_id; end if;
  if s.imported_at is not null then raise exception 'Snapshot % is already imported', p_batch_id; end if;
  if exists (select 1 from liquor_license_snapshots
              where imported_at is not null and snapshot_date >= s.snapshot_date) then
    raise exception 'A roster dated % or later is already imported', s.snapshot_date;
  end if;
  select count(*) into v_rows from liquor_license_staging where snapshot_id = s.id;
  if v_rows = 0 then raise exception 'Snapshot % has no staged rows', p_batch_id; end if;

  v_baseline := not exists (select 1 from liquor_license_snapshots where imported_at is not null);

  -- Normalised incoming rows.
  drop table if exists _in;
  create temp table _in on commit drop as
  select st.license_number,
         nullif(btrim(r ->> 'class_type'), '')        as class_type,
         upper(nullif(btrim(r ->> 'class'), ''))      as class,
         coalesce(array(select upper(btrim(x)) from jsonb_array_elements_text(coalesce(r -> 'secondary', '[]'::jsonb)) x
                         where btrim(x) <> '' order by 1), '{}') as secondary_licenses,
         nullif(btrim(r ->> 'trade_name'), '')        as trade_name,
         nullif(btrim(r ->> 'premises_street'), '')   as premises_street,
         nullif(btrim(r ->> 'premises_city'), '')     as premises_city,
         nullif(btrim(r ->> 'premises_state'), '')    as premises_state,
         nullif(btrim(r ->> 'premises_zip'), '')      as premises_zip,
         nullif(btrim(r ->> 'county'), '')            as county,
         nullif(btrim(r ->> 'county_index'), '')      as county_index,
         nullif(btrim(r ->> 'corporate_limits'), '')  as corporate_limits,
         nullif(btrim(r ->> 'restrictions'), '')      as restrictions,
         nullif(btrim(r ->> 'phone'), '')             as phone,
         nullif(lower(btrim(r ->> 'email')), '')      as email,
         nullif(btrim(r ->> 'manager_name'), '')      as manager_name,
         nullif(btrim(r ->> 'licensee'), '')          as licensee,
         nullif(btrim(r ->> 'corporate_address'), '') as corporate_address,
         nullif(r ->> 'effective_date', '')::date     as effective_date,
         nullif(r ->> 'issue_date', '')::date         as issue_date,
         nullif(r ->> 'expiration_date', '')::date    as expiration_date,
         nullif(btrim(r ->> 'legal_description'), '') as legal_description
    from liquor_license_staging st, lateral (select st.row as r) x
   where st.snapshot_id = s.id;

  -- Pre-images of every existing license this snapshot will touch
  -- (present in it, or active and about to be dropped).
  insert into liquor_license_history (snapshot_id, license_id, prev)
  select s.id, l.id, to_jsonb(l)
    from liquor_licenses l
   where l.license_number in (select license_number from _in)
      or l.status = 'active';

  -- Changes on licenses already on file (recorded before the update).
  insert into liquor_license_changes (snapshot_id, license_id, change_type, old_value, new_value)
  select s.id, l.id, c.change_type, c.old_value, c.new_value
    from liquor_licenses l
    join _in i on i.license_number = l.license_number
    cross join lateral (values
      ('returned',   case when l.status = 'dropped' then 'dropped ' || l.dropped_on end, 'active'),
      ('licensee',   l.licensee,        i.licensee),
      ('trade_name', l.trade_name,      i.trade_name),
      ('manager',    l.manager_name,    i.manager_name),
      ('class',      l.class,           i.class),
      ('address',    concat_ws(', ', l.premises_street, l.premises_city),
                     concat_ws(', ', i.premises_street, i.premises_city))
    ) c(change_type, old_value, new_value)
   where case c.change_type
           when 'returned' then l.status = 'dropped'
           -- A pull without a Manager column (the 5/22/2024 roster) or a blank
           -- manager is "not reported", not "manager left".
           when 'manager'  then i.manager_name is not null and l.manager_name is not null
                            and upper(l.manager_name) is distinct from upper(i.manager_name)
           -- Same company / name once punctuation and LLC, Co, Inc are set aside
           -- ("WHITE STAR OIL CO LLC" -> "WHITE STAR OIL COMPANY LLC" is not a sale).
           when 'licensee'   then normalize_entity_name(l.licensee) is distinct from normalize_entity_name(i.licensee)
           when 'trade_name' then normalize_entity_name(l.trade_name) is distinct from normalize_entity_name(i.trade_name)
           when 'address'  then liquor__addr_sig(l.premises_street, l.premises_city)
                                is distinct from liquor__addr_sig(i.premises_street, i.premises_city)
           else upper(coalesce(c.old_value, '')) is distinct from upper(coalesce(c.new_value, ''))
         end;

  select count(*) filter (where change_type = 'returned'),
         count(distinct license_id) filter (where change_type <> 'returned')
    into v_returned, v_changed
    from liquor_license_changes where snapshot_id = s.id;

  -- Update licenses on file.
  update liquor_licenses l
     set class_type = i.class_type, class = i.class, secondary_licenses = i.secondary_licenses,
         sale_type = liquor_sale_type(i.class),
         trade_name = i.trade_name, premises_street = i.premises_street, premises_city = i.premises_city,
         premises_state = i.premises_state, premises_zip = i.premises_zip, county = i.county,
         county_index = i.county_index, corporate_limits = i.corporate_limits, restrictions = i.restrictions,
         phone = i.phone, email = i.email,
         manager_name = coalesce(i.manager_name, l.manager_name),
         licensee = i.licensee, corporate_address = i.corporate_address,
         effective_date = i.effective_date, issue_date = i.issue_date, expiration_date = i.expiration_date,
         legal_description = i.legal_description,
         status = 'active', dropped_on = null,
         last_seen_snapshot_id = s.id, last_seen_on = s.snapshot_date,
         brand_key = liquor_brand_key(i.trade_name),
         licensee_normalized = nullif(normalize_entity_name(i.licensee), ''),
         premises_normalized = nullif(normalize_address(i.premises_street), ''),
         source_batch_id = s.batch_id,
         updated_at = now()
    from _in i
   where i.license_number = l.license_number;

  -- New licenses.
  insert into liquor_licenses (
    license_number, class_type, class, secondary_licenses, sale_type, trade_name,
    premises_street, premises_city, premises_state, premises_zip, county, county_index,
    corporate_limits, restrictions, phone, email, manager_name, licensee, corporate_address,
    effective_date, issue_date, expiration_date, legal_description,
    status, first_seen_snapshot_id, last_seen_snapshot_id, first_seen_on, last_seen_on,
    brand_key, licensee_normalized, premises_normalized,
    source_system, source_record_id, source_batch_id)
  select i.license_number, i.class_type, i.class, i.secondary_licenses, liquor_sale_type(i.class), i.trade_name,
         i.premises_street, i.premises_city, i.premises_state, i.premises_zip, i.county, i.county_index,
         i.corporate_limits, i.restrictions, i.phone, i.email, i.manager_name, i.licensee, i.corporate_address,
         i.effective_date, i.issue_date, i.expiration_date, i.legal_description,
         'active', s.id, s.id, s.snapshot_date, s.snapshot_date,
         liquor_brand_key(i.trade_name), nullif(normalize_entity_name(i.licensee), ''),
         nullif(normalize_address(i.premises_street), ''),
         'nlcc', i.license_number, s.batch_id
    from _in i
   where not exists (select 1 from liquor_licenses l where l.license_number = i.license_number);
  get diagnostics v_new = row_count;

  if not v_baseline then
    insert into liquor_license_changes (snapshot_id, license_id, change_type, new_value)
    select s.id, l.id, 'new', concat_ws(' — ', l.trade_name, concat_ws(', ', l.premises_street, l.premises_city))
      from liquor_licenses l where l.first_seen_snapshot_id = s.id;
  end if;

  -- Dropped: active licenses this roster doesn't list.
  with gone as (
    update liquor_licenses l
       set status = 'dropped', dropped_on = s.snapshot_date, updated_at = now()
     where l.status = 'active'
       and l.last_seen_snapshot_id is distinct from s.id
    returning l.id, l.trade_name, l.premises_street, l.premises_city
  )
  insert into liquor_license_changes (snapshot_id, license_id, change_type, old_value)
  select s.id, g.id, 'dropped', concat_ws(' — ', g.trade_name, concat_ws(', ', g.premises_street, g.premises_city))
    from gone g;
  get diagnostics v_dropped = row_count;

  -- History rows for licenses this snapshot did not actually change are
  -- harmless but noisy; keep only touched ones (all of them are, since every
  -- listed license gets last_seen updated and every unlisted one is dropped).

  delete from liquor_license_staging where snapshot_id = s.id;

  update liquor_license_snapshots
     set imported_at = now(), is_baseline = v_baseline, row_count = v_rows,
         new_count = case when v_baseline then 0 else v_new end,
         dropped_count = v_dropped, returned_count = v_returned, changed_count = v_changed
   where id = s.id;

  v_link := liquor_auto_link();

  return jsonb_build_object(
    'batch_id', s.batch_id, 'snapshot_date', s.snapshot_date, 'baseline', v_baseline,
    'rows', v_rows, 'added_to_file', v_new,
    'new', case when v_baseline then 0 else v_new end,
    'dropped', v_dropped, 'returned', v_returned, 'changed', v_changed,
    'active_on_file', (select count(*) from liquor_licenses where status = 'active'),
    'links', v_link);
end
$$;

-- Undo the most recent snapshot exactly: licenses it added are deleted, every
-- license it touched goes back to its pre-image (Dan's links and notes made
-- since are kept), its changes are removed. Refuses if a license it added has
-- been linked by Dan or promoted to a contact since.
create or replace function liquor_rollback_snapshot(p_batch_id text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  s liquor_license_snapshots;
  v_deleted int; v_restored int;
begin
  perform pg_advisory_xact_lock(hashtext('liquor_roster'));
  select * into s from liquor_license_snapshots where batch_id = p_batch_id for update;
  if not found then raise exception 'No snapshot %', p_batch_id; end if;
  if s.imported_at is null then
    delete from liquor_license_snapshots where id = s.id;   -- staged only: just discard it
    return jsonb_build_object('batch_id', p_batch_id, 'discarded_unimported', true);
  end if;
  if exists (select 1 from liquor_license_snapshots where imported_at is not null and snapshot_date > s.snapshot_date) then
    raise exception 'Only the most recent snapshot can be rolled back';
  end if;
  if exists (select 1 from liquor_licenses
              where first_seen_snapshot_id = s.id
                and (contact_id is not null or brand_link_source = 'dan'
                     or licensee_link_source = 'dan' or property_link_source = 'dan'
                     or nullif(btrim(notes), '') is not null)) then
    raise exception 'Refused: licenses added by % have been linked, promoted or annotated since. Unlink them first.', p_batch_id;
  end if;

  -- Restore pre-images (roster fields and status only; links/notes stay as they are now).
  update liquor_licenses l
     set class_type = h.prev ->> 'class_type', class = h.prev ->> 'class',
         secondary_licenses = coalesce(array(select jsonb_array_elements_text(h.prev -> 'secondary_licenses')), '{}'),
         sale_type = h.prev ->> 'sale_type', trade_name = h.prev ->> 'trade_name',
         premises_street = h.prev ->> 'premises_street', premises_city = h.prev ->> 'premises_city',
         premises_state = h.prev ->> 'premises_state', premises_zip = h.prev ->> 'premises_zip',
         county = h.prev ->> 'county', county_index = h.prev ->> 'county_index',
         corporate_limits = h.prev ->> 'corporate_limits', restrictions = h.prev ->> 'restrictions',
         phone = h.prev ->> 'phone', email = h.prev ->> 'email', manager_name = h.prev ->> 'manager_name',
         licensee = h.prev ->> 'licensee', corporate_address = h.prev ->> 'corporate_address',
         effective_date = (h.prev ->> 'effective_date')::date, issue_date = (h.prev ->> 'issue_date')::date,
         expiration_date = (h.prev ->> 'expiration_date')::date,
         legal_description = h.prev ->> 'legal_description',
         status = h.prev ->> 'status', dropped_on = (h.prev ->> 'dropped_on')::date,
         last_seen_snapshot_id = (h.prev ->> 'last_seen_snapshot_id')::uuid,
         last_seen_on = (h.prev ->> 'last_seen_on')::date,
         brand_key = h.prev ->> 'brand_key', licensee_normalized = h.prev ->> 'licensee_normalized',
         premises_normalized = h.prev ->> 'premises_normalized',
         source_batch_id = h.prev ->> 'source_batch_id', updated_at = now()
    from liquor_license_history h
   where h.snapshot_id = s.id and h.license_id = l.id;
  get diagnostics v_restored = row_count;

  delete from liquor_licenses where first_seen_snapshot_id = s.id;
  get diagnostics v_deleted = row_count;

  delete from liquor_license_snapshots where id = s.id;   -- cascades history + changes

  perform liquor_auto_link();
  return jsonb_build_object('batch_id', p_batch_id, 'deleted', v_deleted, 'restored', v_restored,
                            'active_on_file', (select count(*) from liquor_licenses where status = 'active'));
end
$$;

-- ===========================================================================
-- 5. Linking
-- ===========================================================================

-- Every name a directory brand answers to, normalised.
create or replace function liquor__brand_names()
returns table (entity_id uuid, key text)
language sql stable
set search_path = public
as $$
  select e.id, e.name_normalized from retail_brands rb join entities e on e.id = rb.entity_id
   where coalesce(e.name_normalized, '') <> ''
  union
  select e.id, normalize_entity_name(e.trade_name) from retail_brands rb join entities e on e.id = rb.entity_id
   where coalesce(normalize_entity_name(e.trade_name), '') <> ''
  union
  select a.entity_id, normalize_entity_name(a.alias) from entity_aliases a
    join retail_brands rb on rb.entity_id = a.entity_id
   where coalesce(normalize_entity_name(a.alias), '') <> '';
$$;

-- Exact-match links, re-run after every import and decision. Never touches a
-- link Dan set on a license ('dan'); a previous 'auto' link that no longer
-- matches uniquely is cleared. A 'dan' / 'dan_key' link whose record was
-- deleted (the FK set it null) goes back to automatic matching.
create or replace function liquor_auto_link()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_brand int; v_licensee int; v_property int;
begin
  update liquor_licenses set brand_link_source = null    where brand_entity_id is null    and brand_link_source is not null;
  update liquor_licenses set licensee_link_source = null where licensee_entity_id is null and licensee_link_source is not null;
  update liquor_licenses set property_link_source = null where property_id is null        and property_link_source is not null;

  -- A decision that was withdrawn or no longer applies to this key (the trade
  -- name changed): its links go back to automatic matching.
  update liquor_licenses l
     set brand_entity_id = null, brand_link_source = null, updated_at = now()
   where l.brand_link_source = 'dan_key'
     and not exists (select 1 from liquor_brand_key_decisions d
                      where d.brand_key = l.brand_key and d.entity_id = l.brand_entity_id);

  -- Brand: Dan's per-key decisions next (never over a link set on the license).
  update liquor_licenses l
     set brand_entity_id = d.entity_id,
         brand_link_source = case when d.entity_id is null then null else 'dan_key' end,
         updated_at = now()
    from liquor_brand_key_decisions d
   where d.brand_key = l.brand_key
     and l.brand_link_source is distinct from 'dan'
     and (l.brand_entity_id is distinct from d.entity_id
          or l.brand_link_source is distinct from case when d.entity_id is null then null else 'dan_key' end);

  -- Then exact brand-name matches (exactly one brand) for keys Dan hasn't decided.
  with m as (
    select bk.key, min(bk.entity_id::text)::uuid as entity_id
      from liquor__brand_names() bk
     group by bk.key
    having count(distinct bk.entity_id) = 1
  ), target as (
    select l.id, m.entity_id
      from liquor_licenses l
      left join m on m.key = l.brand_key
     where coalesce(l.brand_link_source, 'auto') = 'auto'
       and not exists (select 1 from liquor_brand_key_decisions d where d.brand_key = l.brand_key)
  )
  update liquor_licenses l
     set brand_entity_id = t.entity_id,
         brand_link_source = case when t.entity_id is null then null else 'auto' end,
         updated_at = now()
    from target t
   where t.id = l.id and l.brand_entity_id is distinct from t.entity_id;

  -- Licensee: the operating company, exact name (or alias) of any one entity.
  with names as (
    select e.id as entity_id, e.name_normalized as key from entities e where coalesce(e.name_normalized, '') <> ''
    union
    select a.entity_id, normalize_entity_name(a.alias) from entity_aliases a
     where coalesce(normalize_entity_name(a.alias), '') <> ''
  ), m as (
    select key, min(entity_id::text)::uuid as entity_id from names group by key having count(distinct entity_id) = 1
  ), target as (
    select l.id, m.entity_id from liquor_licenses l left join m on m.key = l.licensee_normalized
     where coalesce(l.licensee_link_source, 'auto') = 'auto'
  )
  update liquor_licenses l
     set licensee_entity_id = t.entity_id,
         licensee_link_source = case when t.entity_id is null then null else 'auto' end,
         updated_at = now()
    from target t
   where t.id = l.id and l.licensee_entity_id is distinct from t.entity_id;

  -- Property: same normalised street address and city, exactly one property
  -- (a parent record wins over its suites).
  with m as (
    select p.address_normalized as key, lower(btrim(p.city)) as city,
           min(p.id::text)::uuid as property_id
      from properties p
     where coalesce(p.address_normalized, '') <> '' and p.parent_property_id is null
     group by 1, 2 having count(*) = 1
  ), target as (
    select l.id, m.property_id from liquor_licenses l
      left join m on m.key = l.premises_normalized and m.city = lower(btrim(l.premises_city))
     where coalesce(l.property_link_source, 'auto') = 'auto'
  )
  update liquor_licenses l
     set property_id = t.property_id,
         property_link_source = case when t.property_id is null then null else 'auto' end,
         updated_at = now()
    from target t
   where t.id = l.id and l.property_id is distinct from t.property_id;

  select count(*) filter (where brand_entity_id is not null),
         count(*) filter (where licensee_entity_id is not null),
         count(*) filter (where property_id is not null)
    into v_brand, v_licensee, v_property
    from liquor_licenses where status = 'active';
  return jsonb_build_object('active_with_brand', v_brand, 'active_with_licensee_company', v_licensee,
                            'active_with_property', v_property);
end
$$;

-- Near matches for Dan's review: one row per (brand key, candidate brand),
-- best three candidates per key, only for active keys with no link and no
-- decision. "Contains" means the license's trade name contains the whole
-- brand name ("HY-VEE FOOD STORE" contains "Hy-Vee"); a one-word brand name
-- must be at least 5 letters to count, so "bar" or "inn" never matches
-- everything. Otherwise trigram similarity >= p_min_score.
-- Trigram-indexed temp tables keep this to a second or two at 5,000 licenses
-- x 2,000 brands (a plain cross join took ~30 s, measured 10/26/2026).
create or replace function liquor_brand_suggestions(p_min_score numeric default 0.55, p_limit int default 1000)
returns table (
  brand_key text, sample_trade_name text, license_count int, cities text,
  entity_id uuid, display_code text, brand_name text, score numeric, reason text, rank int)
language plpgsql volatile
set search_path = public, pg_temp
as $$
begin
  perform set_config('pg_trgm.similarity_threshold', greatest(least(coalesce(p_min_score, 0.55), 1), 0.3)::text, true);

  perform set_config('client_min_messages', 'warning', true);
  drop table if exists _lq_keys;
  drop table if exists _lq_names;
  create temp table _lq_keys on commit drop as
    select l.brand_key as k, min(l.trade_name) as sample, count(*)::int as n,
           string_agg(distinct l.premises_city, ', ' order by l.premises_city) as cities
      from liquor_licenses l
     where l.status = 'active' and l.brand_key is not null and l.brand_entity_id is null
       and length(l.brand_key) >= 3
       and not exists (select 1 from liquor_brand_key_decisions d where d.brand_key = l.brand_key)
     group by l.brand_key;
  create temp table _lq_names on commit drop as
    select distinct b.entity_id as eid, b.key as k from liquor__brand_names() b
     where length(b.key) >= 3;
  create index on _lq_keys using gin (k gin_trgm_ops);
  create index on _lq_names using gin (k gin_trgm_ops);
  analyze _lq_keys; analyze _lq_names;

  return query
  with pairs as (
    select k.k as key, nm.eid, 0.9::numeric as sc
      from _lq_names nm
      join _lq_keys k on (' ' || k.k || ' ') like ('% ' || nm.k || ' %')
     where (nm.k like '% %' or length(nm.k) >= 5)
    union all
    select k.k, nm.eid, similarity(k.k, nm.k)::numeric
      from _lq_keys k join _lq_names nm on k.k % nm.k
  ), best as (
    select p.key, p.eid, max(p.sc) as sc from pairs p group by p.key, p.eid
  ), ranked as (
    select b.*, row_number() over (partition by b.key order by b.sc desc, b.eid) as rk
      from best b where b.sc >= coalesce(p_min_score, 0.55)
  )
  select r.key, k.sample, k.n, k.cities, r.eid, e.display_code, e.name, round(r.sc, 2),
         case when r.sc >= 0.9 then 'trade name contains the brand name' else 'similar name' end,
         r.rk::int
    from ranked r
    join _lq_keys k on k.k = r.key
    join entities e on e.id = r.eid
   where r.rk <= 3
   order by k.n desc, r.key, r.rk
   limit greatest(coalesce(p_limit, 1000), 1);
end
$$;

-- Dan's decision on a brand key: link to p_entity_id (must have a brand
-- profile), or p_entity_id null = not a match. p_clear = forget the decision
-- and go back to automatic matching.
create or replace function liquor_decide_brand(p_brand_key text, p_entity_id uuid, p_note text default null, p_clear boolean default false)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_key text := nullif(btrim(p_brand_key), '');
  n int;
begin
  if v_key is null then raise exception 'brand_key is required'; end if;
  if coalesce(p_clear, false) then
    delete from liquor_brand_key_decisions where brand_key = v_key;   -- auto_link releases its 'dan_key' links
  else
    if p_entity_id is not null and not exists (select 1 from retail_brands where entity_id = p_entity_id) then
      raise exception 'Entity % has no brand profile; brand links go to directory brands (use the licensee link for an operating company)', p_entity_id;
    end if;
    insert into liquor_brand_key_decisions (brand_key, entity_id, note) values (v_key, p_entity_id, p_note)
    on conflict (brand_key) do update set entity_id = excluded.entity_id, note = excluded.note, decided_at = now();
  end if;
  perform liquor_auto_link();
  select count(*) into n from liquor_licenses where brand_key = v_key;
  return jsonb_build_object('brand_key', v_key, 'entity_id', p_entity_id, 'cleared', coalesce(p_clear, false),
                            'licenses_with_key', n);
end
$$;

-- Set or clear one license's links by hand (Dan / a Claude session). Each
-- argument left null is left alone; p_clear lists the links to clear
-- ('brand', 'licensee', 'property', 'contact'). A hand-set link is 'dan' and
-- survives every later import; clearing a link hands it back to auto-matching.
create or replace function liquor_link_license(
  p_license_number text,
  p_brand_entity_id uuid default null,
  p_licensee_entity_id uuid default null,
  p_property_id uuid default null,
  p_contact_id uuid default null,
  p_notes text default null,
  p_clear text[] default '{}')
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  l liquor_licenses;
begin
  select * into l from liquor_licenses where license_number = btrim(p_license_number) for update;
  if not found then raise exception 'No liquor license %', p_license_number using errcode = 'P0002'; end if;
  if p_brand_entity_id is not null and not exists (select 1 from retail_brands where entity_id = p_brand_entity_id) then
    raise exception 'Entity % has no brand profile; use the licensee link for an operating company', p_brand_entity_id;
  end if;

  update liquor_licenses set
    brand_entity_id      = case when 'brand' = any (p_clear) then null else coalesce(p_brand_entity_id, brand_entity_id) end,
    brand_link_source    = case when 'brand' = any (p_clear) then null
                                when p_brand_entity_id is not null then 'dan' else brand_link_source end,
    licensee_entity_id   = case when 'licensee' = any (p_clear) then null else coalesce(p_licensee_entity_id, licensee_entity_id) end,
    licensee_link_source = case when 'licensee' = any (p_clear) then null
                                when p_licensee_entity_id is not null then 'dan' else licensee_link_source end,
    property_id          = case when 'property' = any (p_clear) then null else coalesce(p_property_id, property_id) end,
    property_link_source = case when 'property' = any (p_clear) then null
                                when p_property_id is not null then 'dan' else property_link_source end,
    contact_id           = case when 'contact' = any (p_clear) then null else coalesce(p_contact_id, contact_id) end,
    notes                = case when p_notes is null then notes else nullif(btrim(p_notes), '') end,
    updated_at           = now()
  where id = l.id;

  if array_length(p_clear, 1) > 0 then perform liquor_auto_link(); end if;
  select * into l from liquor_licenses where id = l.id;
  return to_jsonb(l);
end
$$;

-- ===========================================================================
-- 6. CRM reads (service role)
-- ===========================================================================

-- Operator = the licensee company when linked, else the normalised licensee
-- name. operator_licenses counts that operator's ACTIVE licenses statewide.
-- p_public (the RTD): group by the licensee NAME only, so nothing about which
-- companies Dan has linked in the CRM shows through the grouping or the counts.
drop function if exists liquor__operator_key(uuid, text);
create or replace function liquor__operator_key(p_licensee_entity_id uuid, p_licensee_normalized text, p_public boolean)
returns text language sql immutable as $$
  select case when p_public then 'n:' || p_licensee_normalized
              else coalesce('e:' || p_licensee_entity_id::text, 'n:' || p_licensee_normalized) end;
$$;

drop function if exists liquor_search(text, text, text, text[], text, int, date, date, uuid, uuid, text, text, int, int);
create or replace function liquor_search(
  p_q              text    default null,
  p_city           text    default null,
  p_county         text    default null,
  p_sale_types     text[]  default null,
  p_status         text    default 'active',    -- active | dropped | all
  p_min_operator   int     default null,        -- operator holds at least N active licenses
  p_new_since      date    default null,        -- first seen on/after (not the baseline)
  p_dropped_since  date    default null,
  p_entity_id      uuid    default null,        -- brand or licensee company
  p_property_id    uuid    default null,
  p_brand          text    default 'any',       -- any | linked | unlinked
  p_sort           text    default 'name',      -- name | operator | newest | city
  p_limit          int     default 50,
  p_offset         int     default 0,
  p_public         boolean default false)       -- the RTD: p_entity_id matches the brand only; name-only operators
returns table (
  id uuid, license_number text, class text, class_label text, sale_type text, secondary_licenses text[],
  trade_name text, premises_street text, premises_city text, premises_zip text, county text,
  phone text, email text, manager_name text, licensee text, corporate_address text,
  issue_date date, expiration_date date, status text, first_seen_on date, last_seen_on date, dropped_on date,
  brand_entity_id uuid, brand_name text, brand_code text, brand_link_source text,
  licensee_entity_id uuid, licensee_entity_name text, licensee_entity_code text, licensee_link_source text,
  property_id uuid, property_code text, property_address text,
  contact_id uuid, notes text, operator_licenses int, total_count bigint)
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_qn text;
  v_baseline uuid;
begin
  if p_limit is null or p_limit < 1 then p_limit := 50; end if;
  if p_limit > 5000 then p_limit := 5000; end if;
  v_qn := case when v_q is null then null else normalize_address(v_q) end;
  select s.id into v_baseline from liquor_license_snapshots s where s.is_baseline;

  return query
  with ops as (
    select liquor__operator_key(x.licensee_entity_id, x.licensee_normalized, p_public) as k, count(*)::int as n
      from liquor_licenses x where x.status = 'active'
     group by 1
  ), f as (
    select l.*, coalesce(o.n, 0) as op_n
      from liquor_licenses l
      left join ops o on o.k = liquor__operator_key(l.licensee_entity_id, l.licensee_normalized, p_public)
     where (coalesce(p_status, 'active') = 'all' or l.status = coalesce(p_status, 'active'))
       and (p_city is null or btrim(p_city) = '' or lower(l.premises_city) = lower(btrim(p_city)))
       and (p_county is null or btrim(p_county) = '' or lower(l.county) = lower(btrim(p_county)))
       and (p_sale_types is null or cardinality(p_sale_types) = 0 or l.sale_type = any (p_sale_types))
       and (p_new_since is null or (l.first_seen_on >= p_new_since and l.first_seen_snapshot_id is distinct from v_baseline))
       and (p_dropped_since is null or l.dropped_on >= p_dropped_since)
       and (p_entity_id is null or l.brand_entity_id = p_entity_id
            or (not p_public and l.licensee_entity_id = p_entity_id))
       and (p_property_id is null or l.property_id = p_property_id)
       and (coalesce(p_brand, 'any') = 'any'
            or (p_brand = 'linked' and l.brand_entity_id is not null)
            or (p_brand = 'unlinked' and l.brand_entity_id is null))
       and (v_q is null
            or l.trade_name ilike '%' || v_q || '%' or l.licensee ilike '%' || v_q || '%'
            or l.manager_name ilike '%' || v_q || '%' or l.license_number = v_q
            or l.email ilike '%' || v_q || '%' or l.premises_city ilike v_q
            or (v_qn <> '' and l.premises_normalized like '%' || v_qn || '%'))
  ), g as (
    select f.* from f where p_min_operator is null or f.op_n >= p_min_operator
  )
  select g.id, g.license_number, g.class, c.label, g.sale_type, g.secondary_licenses,
         g.trade_name, g.premises_street, g.premises_city, g.premises_zip, g.county,
         g.phone, g.email, g.manager_name, g.licensee, g.corporate_address,
         g.issue_date, g.expiration_date, g.status, g.first_seen_on, g.last_seen_on, g.dropped_on,
         g.brand_entity_id, be.name, be.display_code, g.brand_link_source,
         g.licensee_entity_id, le.name, le.display_code, g.licensee_link_source,
         g.property_id, p.display_code, p.address,
         g.contact_id, g.notes, g.op_n, count(*) over ()
    from g
    left join liquor_license_classes c on c.code = g.class
    left join entities be on be.id = g.brand_entity_id
    left join entities le on le.id = g.licensee_entity_id
    left join properties p on p.id = g.property_id
   order by
     case when p_sort = 'operator' then -g.op_n end nulls last,
     case when p_sort = 'newest' then g.first_seen_on end desc nulls last,
     case when p_sort = 'city' then lower(g.premises_city) end,
     case when p_sort = 'operator' then g.licensee end,
     lower(g.trade_name), g.premises_city, g.license_number
   limit p_limit offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- Multi-unit operators: one row per operator with its active licenses.
drop function if exists liquor_operators(int, text, text, text[], text, int, int);
create or replace function liquor_operators(
  p_min_licenses int    default 2,
  p_county       text   default null,
  p_city         text   default null,
  p_sale_types   text[] default null,
  p_q            text   default null,
  p_limit        int    default 100,
  p_offset       int    default 0,
  p_public       boolean default false)
returns table (
  operator_key text, licensee text, licensee_entity_id uuid, licensee_entity_name text, licensee_entity_code text,
  license_count int, in_area_count int, cities text, trade_names text, brand_names text,
  sample_email text, sample_phone text, corporate_address text, total_count bigint)
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if p_limit is null or p_limit < 1 then p_limit := 100; end if;
  if p_limit > 5000 then p_limit := 5000; end if;
  return query
  with a as (
    select l.*, liquor__operator_key(l.licensee_entity_id, l.licensee_normalized, p_public) as k,
           ((p_county is null or btrim(p_county) = '' or lower(l.county) = lower(btrim(p_county)))
            and (p_city is null or btrim(p_city) = '' or lower(l.premises_city) = lower(btrim(p_city)))
            and (p_sale_types is null or cardinality(p_sale_types) = 0 or l.sale_type = any (p_sale_types))) as in_area
      from liquor_licenses l
     where l.status = 'active' and l.licensee_normalized is not null
  ), grp as (
    select a.k,
           mode() within group (order by a.licensee) as lic,
           max(a.licensee_entity_id::text)::uuid as le_id,
           count(*)::int as n,
           count(*) filter (where a.in_area)::int as n_area,
           string_agg(distinct a.premises_city, ', ' order by a.premises_city) as cities,
           string_agg(distinct a.trade_name, '; ' order by a.trade_name) as trades,
           mode() within group (order by a.email) as em,
           mode() within group (order by a.phone) as ph,
           mode() within group (order by a.corporate_address) as corp,
           array_remove(array_agg(distinct a.brand_entity_id), null) as brands
      from a group by a.k
  )
  select g.k, g.lic, g.le_id, le.name, le.display_code, g.n, g.n_area, g.cities,
         left(g.trades, 400),
         (select string_agg(e.name, ', ' order by e.name) from entities e
           where e.id = any (g.brands) and exists (select 1 from retail_brands rb where rb.entity_id = e.id)),
         g.em, g.ph, g.corp, count(*) over ()
    from grp g
    left join entities le on le.id = g.le_id
   where g.n >= coalesce(p_min_licenses, 2) and g.n_area > 0
     and (v_q is null or g.lic ilike '%' || v_q || '%' or g.trades ilike '%' || v_q || '%')
   order by g.n_area desc, g.n desc, g.lic
   limit p_limit offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- What the roster pulls say changed: openings, closures, sales, re-brands.
create or replace function liquor_changes(
  p_since       date   default null,
  p_types       text[] default null,
  p_county      text   default null,
  p_city        text   default null,
  p_sale_types  text[] default null,
  p_limit       int    default 100,
  p_offset      int    default 0)
returns table (
  change_id uuid, snapshot_date date, change_type text, old_value text, new_value text,
  license_number text, trade_name text, premises_street text, premises_city text, county text,
  sale_type text, licensee text, manager_name text, phone text, email text, status text,
  brand_entity_id uuid, licensee_entity_id uuid, property_id uuid, total_count bigint)
language sql stable
set search_path = public
as $$
  select ch.id, s.snapshot_date, ch.change_type, ch.old_value, ch.new_value,
         l.license_number, l.trade_name, l.premises_street, l.premises_city, l.county,
         l.sale_type, l.licensee, l.manager_name, l.phone, l.email, l.status,
         l.brand_entity_id, l.licensee_entity_id, l.property_id, count(*) over ()
    from liquor_license_changes ch
    join liquor_license_snapshots s on s.id = ch.snapshot_id
    join liquor_licenses l on l.id = ch.license_id
   where (p_since is null or s.snapshot_date >= p_since)
     and (p_types is null or cardinality(p_types) = 0 or ch.change_type = any (p_types))
     and (p_county is null or btrim(p_county) = '' or lower(l.county) = lower(btrim(p_county)))
     and (p_city is null or btrim(p_city) = '' or lower(l.premises_city) = lower(btrim(p_city)))
     and (p_sale_types is null or cardinality(p_sale_types) = 0 or l.sale_type = any (p_sale_types))
   order by s.snapshot_date desc, ch.change_type, l.trade_name
   limit greatest(coalesce(p_limit, 100), 1) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function liquor_meta()
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'latest_snapshot_date', (select max(snapshot_date) from liquor_license_snapshots where imported_at is not null),
    'active', (select count(*) from liquor_licenses where status = 'active'),
    'dropped', (select count(*) from liquor_licenses where status = 'dropped'),
    'with_brand', (select count(*) from liquor_licenses where status = 'active' and brand_entity_id is not null),
    'with_licensee_company', (select count(*) from liquor_licenses where status = 'active' and licensee_entity_id is not null),
    'with_property', (select count(*) from liquor_licenses where status = 'active' and property_id is not null),
    'snapshots', coalesce((select jsonb_agg(jsonb_build_object(
        'batch_id', s.batch_id, 'snapshot_date', s.snapshot_date, 'source_file', s.source_file,
        'imported_at', s.imported_at, 'baseline', s.is_baseline, 'rows', coalesce(s.row_count, s.staged_count),
        'new', s.new_count, 'dropped', s.dropped_count, 'returned', s.returned_count, 'changed', s.changed_count)
        order by s.snapshot_date desc) from liquor_license_snapshots s), '[]'::jsonb),
    'counties', coalesce((select jsonb_agg(c order by c) from (select distinct county c from liquor_licenses
                           where status = 'active' and county is not null) x), '[]'::jsonb),
    'classes', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'label', label, 'sale_type', sale_type)
                           order by sort_order) from liquor_license_classes), '[]'::jsonb));
$$;

-- ===========================================================================
-- 6b. Merges keep Dan's liquor links (016 / 026 merge functions, wrapped the
--     same way 026 wrapped merge_entities). Without this a merged-away entity
--     or property would be deleted out from under the license links ('dan'
--     links lost) and its brand-key decisions (FK cascade) with it.
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'merge_entities_026') then
    alter function merge_entities(uuid, uuid) rename to merge_entities_026;
  end if;
  if not exists (select 1 from pg_proc where proname = 'merge_properties_016') then
    alter function merge_properties(uuid, uuid) rename to merge_properties_016;
  end if;
end
$$;

create or replace function merge_entities(p_keep_id uuid, p_merge_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  update liquor_licenses set brand_entity_id = p_keep_id, updated_at = now() where brand_entity_id = p_merge_id;
  get diagnostics n = row_count;
  update liquor_licenses set licensee_entity_id = p_keep_id, updated_at = now() where licensee_entity_id = p_merge_id;
  update liquor_brand_key_decisions set entity_id = p_keep_id where entity_id = p_merge_id;
  return merge_entities_026(p_keep_id, p_merge_id) || jsonb_build_object('liquor_brand_links_moved', n);
end
$$;

create or replace function merge_properties(p_keep_id uuid, p_merge_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update liquor_licenses set property_id = p_keep_id, updated_at = now() where property_id = p_merge_id;
  return merge_properties_016(p_keep_id, p_merge_id);
end
$$;

-- ===========================================================================
-- 7. RTD window (SECURITY DEFINER; refuses anyone not on rtd_users)
--    Public-record roster fields + the RTD brand only. Never: notes, property
--    links, non-brand company links, contact links, link sources.
-- ===========================================================================
create or replace function rtd_liquor_meta()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  perform rtd_current_user();
  v := liquor_meta();
  return jsonb_build_object(
    'latest_snapshot_date', v -> 'latest_snapshot_date', 'active', v -> 'active',
    'counties', v -> 'counties', 'classes', v -> 'classes',
    'snapshots', coalesce((select jsonb_agg(jsonb_build_object('snapshot_date', x -> 'snapshot_date',
                   'new', x -> 'new', 'dropped', x -> 'dropped', 'baseline', x -> 'baseline'))
                   from jsonb_array_elements(v -> 'snapshots') x), '[]'::jsonb));
end
$$;

create or replace function rtd_liquor_search(
  p_q              text    default null,
  p_city           text    default null,
  p_county         text    default null,
  p_sale_types     text[]  default null,
  p_status         text    default 'active',
  p_min_operator   int     default null,
  p_new_since      date    default null,
  p_dropped_since  date    default null,
  p_entity_id      uuid    default null,
  p_sort           text    default 'name',
  p_limit          int     default 50,
  p_offset         int     default 0)
returns table (
  license_number text, class text, class_label text, sale_type text, secondary_licenses text[],
  trade_name text, premises_street text, premises_city text, premises_zip text, county text,
  phone text, email text, manager_name text, licensee text, corporate_address text,
  issue_date date, expiration_date date, status text, first_seen_on date, dropped_on date,
  brand_entity_id uuid, brand_name text, operator_licenses int, total_count bigint)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform rtd_current_user();
  if p_entity_id is not null and not exists (select 1 from retail_brands where entity_id = p_entity_id) then
    return;   -- the RTD only looks licenses up by directory brand
  end if;
  return query
  select s.license_number, s.class, s.class_label, s.sale_type, s.secondary_licenses,
         s.trade_name, s.premises_street, s.premises_city, s.premises_zip, s.county,
         s.phone, s.email, s.manager_name, s.licensee, s.corporate_address,
         s.issue_date, s.expiration_date, s.status, s.first_seen_on, s.dropped_on,
         case when rb.entity_id is not null then s.brand_entity_id end,
         case when rb.entity_id is not null then s.brand_name end,
         s.operator_licenses, s.total_count
    from liquor_search(p_q, p_city, p_county, p_sale_types, p_status, p_min_operator, p_new_since,
                       p_dropped_since, p_entity_id, null, 'any', p_sort, p_limit, p_offset, true) s
    left join retail_brands rb on rb.entity_id = s.brand_entity_id;
end
$$;

create or replace function rtd_liquor_operators(
  p_min_licenses int    default 2,
  p_county       text   default null,
  p_city         text   default null,
  p_sale_types   text[] default null,
  p_q            text   default null,
  p_limit        int    default 100,
  p_offset       int    default 0)
returns table (
  operator_key text, licensee text, license_count int, in_area_count int, cities text, trade_names text,
  brand_names text, sample_email text, sample_phone text, corporate_address text, total_count bigint)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform rtd_current_user();
  return query
  select md5(o.operator_key), o.licensee, o.license_count, o.in_area_count, o.cities, o.trade_names,
         o.brand_names, o.sample_email, o.sample_phone, o.corporate_address, o.total_count
    from liquor_operators(p_min_licenses, p_county, p_city, p_sale_types, p_q, p_limit, p_offset, true) o;
end
$$;

-- Brand page panel: the brand's Nebraska licenses (active first).
create or replace function rtd_brand_liquor(p_entity_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform rtd_current_user();
  if not exists (select 1 from retail_brands where entity_id = p_entity_id) then
    return jsonb_build_object('active', 0, 'licenses', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'active', (select count(*) from liquor_licenses where brand_entity_id = p_entity_id and status = 'active'),
    'latest_snapshot_date', (select max(snapshot_date) from liquor_license_snapshots where imported_at is not null),
    'licenses', coalesce((select jsonb_agg(jsonb_build_object(
        'license_number', l.license_number, 'class', l.class, 'sale_type', l.sale_type,
        'trade_name', l.trade_name, 'premises_street', l.premises_street, 'premises_city', l.premises_city,
        'county', l.county, 'licensee', l.licensee, 'manager_name', l.manager_name,
        'phone', l.phone, 'email', l.email, 'status', l.status, 'dropped_on', l.dropped_on)
        order by l.status, l.premises_city, l.premises_street)
        from liquor_licenses l where l.brand_entity_id = p_entity_id), '[]'::jsonb));
end
$$;

-- ===========================================================================
-- 8. Grants — service_role (the CRM) has everything via 028's defaults; the
--    RTD's signed-in users get the four rtd_liquor_* entry points only.
-- ===========================================================================
revoke all on liquor_license_classes, liquor_license_snapshots, liquor_licenses, liquor_license_staging,
  liquor_license_history, liquor_license_changes, liquor_brand_key_decisions from anon, authenticated;
grant all on liquor_license_classes, liquor_license_snapshots, liquor_licenses, liquor_license_staging,
  liquor_license_history, liquor_license_changes, liquor_brand_key_decisions to service_role;

revoke execute on function
  liquor_sale_type(text), liquor_brand_key(text), liquor__addr_sig(text, text),
  liquor_begin_snapshot(text, date, text, text, boolean), liquor_stage_rows(text, jsonb),
  liquor_import_snapshot(text), liquor_rollback_snapshot(text),
  liquor__brand_names(), liquor_auto_link(), liquor_brand_suggestions(numeric, int),
  liquor_decide_brand(text, uuid, text, boolean),
  liquor_link_license(text, uuid, uuid, uuid, uuid, text, text[]),
  liquor__operator_key(uuid, text, boolean),
  liquor_search(text, text, text, text[], text, int, date, date, uuid, uuid, text, text, int, int, boolean),
  liquor_operators(int, text, text, text[], text, int, int, boolean),
  merge_entities(uuid, uuid), merge_properties(uuid, uuid),
  liquor_changes(date, text[], text, text, text[], int, int),
  liquor_meta()
  from public, anon, authenticated;

revoke execute on function
  rtd_liquor_meta(),
  rtd_liquor_search(text, text, text, text[], text, int, date, date, uuid, text, int, int),
  rtd_liquor_operators(int, text, text, text[], text, int, int),
  rtd_brand_liquor(uuid)
  from public, anon;
grant execute on function
  rtd_liquor_meta(),
  rtd_liquor_search(text, text, text, text[], text, int, date, date, uuid, text, int, int),
  rtd_liquor_operators(int, text, text, text[], text, int, int),
  rtd_brand_liquor(uuid)
  to authenticated;

commit;
