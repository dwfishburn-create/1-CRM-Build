-- Dan Fishburn CRM — migration 034
-- RealNex properties + owners onto the map (Retail Listing Intake & Matching,
-- Phase 2 — Dan, 11/10/2026: "yes", properties and owners only, ahead of the
-- full RealNex import).
--
-- Two functions, called by the CRM's /admin/realnex-import page (server-side,
-- secret key) in chunks of rows from data/realnex_properties_2026-09-18.json:
--
--   import_realnex_properties(p_rows jsonb, p_batch text) -> jsonb counts
--   rollback_realnex_property_import(p_batch text)       -> jsonb counts
--
-- Matching (exact only — anything fuzzy is left alone rather than guessed):
--   property: already imported (source_record_id) -> same parcel number ->
--             same normalized address + city + suite (016's normalize_address).
--             A match is NEVER edited; it only gains an owner link when it has
--             no owner on file at all.
--   owner:    same normalized entity name (016's normalize_entity_name), on the
--             entity or one of its aliases -> link to that entity; otherwise a
--             new entity. One entity per distinct owner name in the file.
-- New properties: research_status 'partial' when RealNex names an owner (owner
-- per RealNex is unverified), else 'unresearched'; market_status 'off_market'
-- (RealNex for-sale/for-lease flags are years old — kept in notes, not used).
--
-- Provenance on every inserted row: source_system 'realnex',
-- source_batch_id = p_batch. properties.source_record_id = RealNex property_key;
-- entities = 'owner:' || normalized name; property_owner = 'owner:' || property_key.
-- Re-runnable: a second run inserts 0 rows.
--
-- Run once in the Supabase SQL editor ("Run without RLS"), then
-- notify pgrst, 'reload schema';

create or replace function import_realnex_properties(p_rows jsonb, p_batch text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if coalesce(p_batch, '') = '' then
    raise exception 'p_batch is required';
  end if;

  create temp table if not exists rn_stage (
    key text primary key,
    address text, suite text, city text, state text, zip text, parcel text,
    property_type text, building_sf numeric, land_acres numeric, year_built int,
    submarket text, lat double precision, lng double precision,
    owner_name text, owner_contact text, trans_date date, notes text,
    addr_n text, parcel_n text, owner_n text, dedupe_key text, first_key text,
    prop_id uuid, prop_action text, owner_id uuid, owner_action text, link_action text
  ) on commit drop;
  truncate rn_stage;

  insert into rn_stage (key, address, suite, city, state, zip, parcel, property_type,
                        building_sf, land_acres, year_built, submarket, lat, lng,
                        owner_name, owner_contact, trans_date, notes)
  select x.key, btrim(x.address), nullif(btrim(x.suite), ''), nullif(btrim(x.city), ''),
         coalesce(nullif(upper(btrim(x.state)), ''), 'NE'), x.zip, x.parcel, x.property_type,
         x.building_sf, x.land_acres, x.year_built, x.submarket, x.lat, x.lng,
         nullif(btrim(x.owner_name), ''), x.owner_contact, x.trans_date, x.notes
    from jsonb_to_recordset(p_rows) as x(
      key text, address text, suite text, city text, state text, zip text, parcel text,
      property_type text, building_sf numeric, land_acres numeric, year_built int,
      submarket text, lat double precision, lng double precision,
      owner_name text, owner_contact text, trans_date date, notes text)
   where coalesce(btrim(x.address), '') <> ''
  on conflict (key) do nothing;

  update rn_stage set
    addr_n   = normalize_address(address),
    parcel_n = regexp_replace(lower(coalesce(parcel, '')), '[^a-z0-9]', '', 'g'),
    owner_n  = case when owner_name is null then null else normalize_entity_name(owner_name) end;
  update rn_stage set
    dedupe_key = addr_n || '|' || lower(coalesce(city, '')) || '|' || lower(coalesce(suite, ''));

  -- ---- Properties -------------------------------------------------------
  update rn_stage s set prop_id = p.id, prop_action = 'already_imported'
    from properties p
   where p.source_system = 'realnex' and p.source_record_id = s.key;

  update rn_stage s set prop_id = m.id, prop_action = 'matched_parcel'
    from (select distinct on (s2.key) s2.key, p.id
            from rn_stage s2
            join properties p
              on regexp_replace(lower(coalesce(p.parcel_number, '')), '[^a-z0-9]', '', 'g') = s2.parcel_n
           where s2.prop_id is null and s2.parcel_n <> ''
           order by s2.key, p.created_at) m
   where s.key = m.key;

  update rn_stage s set prop_id = m.id, prop_action = 'matched_address'
    from (select distinct on (s2.key) s2.key, p.id
            from rn_stage s2
            join properties p
              on p.address_normalized = s2.addr_n
             and lower(coalesce(p.city, '')) = lower(coalesce(s2.city, ''))
             and lower(coalesce(p.suite_number, '')) = lower(coalesce(s2.suite, ''))
           where s2.prop_id is null and s2.addr_n <> ''
           order by s2.key, p.created_at) m
   where s.key = m.key;

  -- The same building twice in the file: the first key creates it, the rest
  -- point at it.
  update rn_stage s set first_key = f.first_key
    from (select key, first_value(key) over (partition by dedupe_key order by key) as first_key
            from rn_stage where prop_id is null) f
   where s.key = f.key;

  with ins as (
    insert into properties (display_code, address, suite_number, city, state, zip,
                            parcel_number, property_type, building_sf, land_acres,
                            year_built, submarket, latitude, longitude, research_status,
                            market_status, notes, source_system, source_record_id,
                            source_batch_id)
    select next_display_code('properties', 'PROP'), s.address, s.suite, s.city, s.state,
           s.zip, s.parcel, s.property_type, s.building_sf, s.land_acres, s.year_built,
           s.submarket, s.lat, s.lng,
           case when s.owner_name is not null then 'partial' else 'unresearched' end,
           'off_market', s.notes, 'realnex', s.key, p_batch
      from rn_stage s
     where s.prop_id is null and s.key = s.first_key
     order by s.key
    returning id, source_record_id
  )
  update rn_stage s set prop_id = ins.id, prop_action = 'created'
    from ins where ins.source_record_id = s.key;

  update rn_stage s set prop_id = f.prop_id, prop_action = 'duplicate_in_file'
    from rn_stage f
   where s.prop_id is null and f.key = s.first_key and f.prop_id is not null;

  -- ---- Owners -----------------------------------------------------------
  update rn_stage s set owner_id = e.id, owner_action = 'already_imported'
    from entities e
   where s.owner_n is not null and s.owner_n <> ''
     and e.source_system = 'realnex' and e.source_record_id = 'owner:' || s.owner_n;

  update rn_stage s set owner_id = m.id, owner_action = 'matched_name'
    from (select distinct on (s2.owner_n) s2.owner_n, e.id
            from rn_stage s2
            join entities e on e.name_normalized = s2.owner_n
           where s2.owner_id is null and coalesce(s2.owner_n, '') <> ''
           order by s2.owner_n, e.created_at) m
   where s.owner_n = m.owner_n and s.owner_id is null;

  update rn_stage s set owner_id = m.entity_id, owner_action = 'matched_alias'
    from (select distinct on (s2.owner_n) s2.owner_n, a.entity_id
            from rn_stage s2
            join entity_aliases a on normalize_entity_name(a.alias) = s2.owner_n
           where s2.owner_id is null and coalesce(s2.owner_n, '') <> ''
           order by s2.owner_n, a.created_at) m
   where s.owner_n = m.owner_n and s.owner_id is null;

  with o as (
    select distinct on (owner_n) owner_n, owner_name, owner_contact
      from rn_stage
     where owner_id is null and coalesce(owner_n, '') <> ''
     order by owner_n, key
  ), ins as (
    insert into entities (display_code, name, entity_type, notes,
                          source_system, source_record_id, source_batch_id)
    select next_display_code('entities', 'ENT'), o.owner_name,
           case
             when o.owner_name ~* '\y(llc|l\.l\.c\.)\y' then 'LLC'
             when o.owner_name ~* '\y(inc|corp|corporation|incorporated|co)\y' then 'Corporation'
             when o.owner_name ~* '\ytrust\y' then 'Trust'
             when o.owner_name ~* '\y(lp|llp|partnership|partners)\y' then 'Partnership'
             else null
           end,
           'Property owner per RealNex (unverified) — created by the 11/10/2026 RealNex property import.'
             || case when o.owner_contact is not null
                     then E'\nContact named on a RealNex record: ' || o.owner_contact else '' end,
           'realnex', 'owner:' || o.owner_n, p_batch
      from o
     order by o.owner_n
    returning id, source_record_id
  )
  update rn_stage s set owner_id = ins.id, owner_action = 'created'
    from ins where ins.source_record_id = 'owner:' || s.owner_n;

  -- ---- Owner links --------------------------------------------------------
  -- New properties always get their owner. A matched existing property gets
  -- one only when it has no owner on file at all — Dan's own research wins.
  update rn_stage s set link_action = 'already_linked'
   where s.owner_id is not null and s.prop_id is not null
     and exists (select 1 from property_owner po
                  where po.property_id = s.prop_id and po.entity_id = s.owner_id);

  update rn_stage s set link_action = 'skipped_has_owner'
   where s.link_action is null and s.owner_id is not null and s.prop_id is not null
     and s.prop_action in ('matched_parcel', 'matched_address')
     and exists (select 1 from property_owner po where po.property_id = s.prop_id);

  with cand as (
    select distinct on (s.prop_id, s.owner_id) s.key, s.prop_id, s.owner_id, s.trans_date
      from rn_stage s
     where s.link_action is null and s.owner_id is not null and s.prop_id is not null
     order by s.prop_id, s.owner_id, s.key
  ), ins as (
    insert into property_owner (property_id, entity_id, ownership_start_date, is_current,
                                source_system, source_record_id, source_batch_id)
    select c.prop_id, c.owner_id, c.trans_date, true, 'realnex', 'owner:' || c.key, p_batch
      from cand c
    on conflict do nothing
    returning source_record_id
  )
  update rn_stage s set link_action = 'created'
    from ins where ins.source_record_id = 'owner:' || s.key;

  select jsonb_build_object(
    'rows', (select count(*) from rn_stage),
    'properties', (select coalesce(jsonb_object_agg(a, n), '{}'::jsonb)
                     from (select coalesce(prop_action, 'none') a, count(*) n from rn_stage group by 1) t),
    'owners', (select coalesce(jsonb_object_agg(a, n), '{}'::jsonb)
                 from (select coalesce(owner_action, 'no_owner') a, count(*) n from rn_stage group by 1) t),
    'owner_links', (select coalesce(jsonb_object_agg(a, n), '{}'::jsonb)
                      from (select coalesce(link_action, 'none') a, count(*) n from rn_stage group by 1) t)
  ) into v_result;

  return v_result;
end;
$$;

-- Undo exactly one batch: owner links -> properties -> entities. Stops (and
-- changes nothing) if anything outside the batch now points at an imported
-- property or entity — a deal, an activity, a lease, a hand-made owner link.
create or replace function rollback_realnex_property_import(p_batch text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n bigint;
  has_batch boolean;
  found_rows text := '';
  d_links int; d_props int; d_ents int;
begin
  if coalesce(p_batch, '') = '' then
    raise exception 'p_batch is required';
  end if;

  for r in
    select c.conrelid::regclass::text as tbl, a.attname::text as col,
           c.confrelid::regclass::text as ref
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid in ('public.properties'::regclass, 'public.entities'::regclass)
       and array_length(c.conkey, 1) = 1
  loop
    select exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = r.tbl
                      and column_name = 'source_batch_id') into has_batch;
    execute format(
      'select count(*) from %s t where t.%I in (select id from %s where source_batch_id = %L)%s',
      r.tbl, r.col, r.ref, p_batch,
      case when has_batch
           then format(' and t.source_batch_id is distinct from %L', p_batch) else '' end)
      into n;
    if n > 0 then
      found_rows := found_rows || format(E'\n  %s.%s -> imported %s: %s row(s)', r.tbl, r.col, r.ref, n);
    end if;
  end loop;

  if found_rows <> '' then
    raise exception 'Rollback stopped — rows outside batch % reference imported rows:%', p_batch, found_rows
      using hint = 'Nothing was deleted.';
  end if;

  delete from property_owner where source_batch_id = p_batch;
  get diagnostics d_links = row_count;
  delete from properties where source_batch_id = p_batch;
  get diagnostics d_props = row_count;
  delete from entities where source_batch_id = p_batch;
  get diagnostics d_ents = row_count;

  return jsonb_build_object('owner_links_deleted', d_links,
                            'properties_deleted', d_props,
                            'entities_deleted', d_ents);
end;
$$;

-- Batch status for the admin page.
create or replace function realnex_property_import_status(p_batch text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'properties', (select count(*) from properties where source_batch_id = p_batch),
    'properties_geocoded', (select count(*) from properties where source_batch_id = p_batch and latitude is not null),
    'entities', (select count(*) from entities where source_batch_id = p_batch),
    'owner_links', (select count(*) from property_owner where source_batch_id = p_batch),
    'all_properties', (select count(*) from properties),
    'all_entities', (select count(*) from entities)
  );
$$;

revoke all on function import_realnex_properties(jsonb, text) from public, anon, authenticated;
revoke all on function rollback_realnex_property_import(text) from public, anon, authenticated;
revoke all on function realnex_property_import_status(text) from public, anon, authenticated;
