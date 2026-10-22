-- 031_rtd_saved_searches.sql — saved searches on "Fits this space" (10/22/2026)
--
-- Dan, for Trey's former Fazoli's drive-thru sale listing: "Is it possible to
-- create some kind of a 'saved search' within the RTD so Trey only has to create
-- the search criteria once?" Then: "I am not sure I want anything to be private
-- at this point." So:
--   * Every saved search is visible to all three (Dan, Jami, Trey) and anyone
--     can run it. There is no private or shared switch.
--   * Who saved it is shown; the person who saved it, or Dan, can update or
--     delete it (the same rule as Undo). Anyone can "save as new" from it.
--   * "New since you last looked" is per person: the brands in the results that
--     changed since that person last opened the search.
-- Search changes (rtd_search redefined):
--   * Several categories at once (p_category comma-separated), so one saved
--     search covers QSR + fast casual + coffee.
--   * "Has a drive-thru" now ranks brands that require, then prefer, a
--     drive-thru first (it used to change nothing).
--   * p_include_unsized: also list brands with no size on file (fit 'unknown').
--   * Returns changed_at for the "new" marks.
--   * Exclusives (Dan: a center with two bays and "no new hair salons or pizza
--     restaurants"): p_exclude_categories and p_exclude_words (matched against
--     the brand name, trade name and RealNex category detail) drop brands a
--     lease exclusive rules out; p_show_excluded lists them anyway, marked, so
--     the exclusions can be checked. Saved searches carry them, and a
--     "listing" label groups one center's bays (one saved search per bay).
--
-- Builds on 028/029/030. Re-runnable.

begin;

-- ===========================================================================
-- 1. Tables
-- ===========================================================================
create table if not exists rtd_saved_searches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  listing     text check (listing is null or length(listing) <= 120),  -- groups a center's bays together
  params      jsonb not null default '{}'::jsonb,   -- size, market, categories[], site, close, unverified, unsized, q
  created_by  uuid not null references rtd_users(id),
  created_at  timestamptz not null default now(),
  updated_by  uuid references rtd_users(id),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references rtd_users(id)
);
alter table rtd_saved_searches add column if not exists listing text;
create index if not exists idx_rtd_saved_searches_live on rtd_saved_searches (created_at) where deleted_at is null;
alter table rtd_saved_searches enable row level security;
revoke all on rtd_saved_searches from anon, authenticated;

create table if not exists rtd_saved_search_views (
  search_id   uuid not null references rtd_saved_searches(id) on delete cascade,
  user_id     uuid not null references rtd_users(id),
  viewed_at   timestamptz not null default now(),
  primary key (search_id, user_id)
);
alter table rtd_saved_search_views enable row level security;
revoke all on rtd_saved_search_views from anon, authenticated;

-- ===========================================================================
-- 2. rtd_search, redefined (new argument + new column → drop and recreate)
-- ===========================================================================
drop function if exists rtd_search(numeric, text, text, text, text, boolean, boolean, int, int);
drop function if exists rtd_search(numeric, text, text, text, text, boolean, boolean, int, int, boolean);
drop function if exists rtd_search(numeric, text, text, text, text, boolean, boolean, int, int, boolean, text, text, boolean);

create function rtd_search(
  p_size            numeric default null,
  p_market          text    default null,
  p_category        text    default null,
  p_site            text    default 'any',
  p_q               text    default null,
  p_include_close   boolean default true,
  p_unverified_only boolean default false,
  p_limit           int     default 100,
  p_offset          int     default 0,
  p_include_unsized boolean default false,
  p_exclude_categories text default null,   -- comma-separated category codes (a center's exclusives)
  p_exclude_words   text    default null,   -- comma-separated words: brand name, trade name or category detail
  p_show_excluded   boolean default false   -- list them anyway, marked, to check the exclusions
)
returns table (
  entity_id          uuid,
  display_code       text,
  name               text,
  category           text,
  category_label     text,
  size_min_sf        numeric,
  size_max_sf        numeric,
  fit                text,       -- fits | close | none (no size searched)
  fit_delta_pct      int,        -- close only: + brand wants more, - brand wants less
  drive_thru         text,
  facility_types     text[],
  expansion_status   text,
  target_markets     text[],
  market_set         boolean,
  needs_verification boolean,
  last_verified_on   date,
  contact_name       text,
  contact_title      text,
  contact_email      text,
  contact_phone      text,
  contact_count      int,
  active_requirements int,
  total_count        bigint,
  changed_at         timestamptz,
  excluded_by        text,       -- why an exclusive rules it out (only when p_show_excluded)
  excluded_count     int         -- how many fitting brands the exclusives removed
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  -- One category or several, comma-separated (031).
  v_cats text[] := (select nullif(array_agg(btrim(c)) filter (where btrim(c) <> ''), '{}')
                      from unnest(string_to_array(coalesce(p_category, ''), ',')) c);
  v_xcats text[] := (select nullif(array_agg(btrim(c)) filter (where btrim(c) <> ''), '{}')
                       from unnest(string_to_array(coalesce(p_exclude_categories, ''), ',')) c);
  v_xwords text[] := (select nullif(array_agg(lower(btrim(w))) filter (where length(btrim(w)) >= 2), '{}')
                        from unnest(string_to_array(coalesce(p_exclude_words, ''), ',')) w);
begin
  perform rtd_current_user();
  if p_limit is null or p_limit < 1 then p_limit := 100; end if;
  if p_limit > 5000 then p_limit := 5000; end if;

  return query
  with b as (
    select e.id as eid, e.display_code as code, e.name as ename, rb.*,
           rc.label as cat_label,
           case
             when p_size is null then 'none'
             when rb.size_min_sf is null and rb.size_max_sf is null then 'unknown'
             when (rb.size_min_sf is null or rb.size_min_sf <= p_size)
              and (rb.size_max_sf is null or rb.size_max_sf >= p_size) then 'fits'
             when rb.size_min_sf is not null and p_size < rb.size_min_sf
              and rb.size_min_sf - p_size <= p_size * 0.15 then 'close'
             when rb.size_max_sf is not null and p_size > rb.size_max_sf
              and p_size - rb.size_max_sf <= p_size * 0.15 then 'close'
             else 'out'
           end as fit_v,
           -- The first exclusive that rules the brand out, if any.
           case
             when v_xcats is not null and rb.category = any (v_xcats) then 'category: ' || coalesce(rc.label, rb.category)
             else (select '"' || w || '"' from unnest(v_xwords) w
                    where lower(e.name) like '%' || w || '%'
                       or lower(coalesce(e.trade_name, '')) like '%' || w || '%'
                       or lower(coalesce(rb.category_detail, '')) like '%' || w || '%'
                    limit 1)
           end as x_by
      from rtd__effective_brands() rb
      join entities e on e.id = rb.entity_id
      left join retail_categories rc on rc.code = rb.category
     where (v_cats is null or rb.category = any (v_cats))
       and (p_market is null or p_market = '' or rb.target_markets = '{}'
            or p_market = any (rb.target_markets))
       and (coalesce(p_site, 'any') <> 'no_drive_thru' or rb.drive_thru is distinct from 'required')
       and (not coalesce(p_unverified_only, false) or rb.needs_verification)
       and (v_q is null or e.name ilike '%' || v_q || '%' or e.trade_name ilike '%' || v_q || '%')
  ), f0 as (
    select * from b
     where fit_v in ('none', 'fits') or (fit_v = 'close' and coalesce(p_include_close, true))
        or (fit_v = 'unknown' and coalesce(p_include_unsized, false))
  ), f as (
    select * from f0 where x_by is null or coalesce(p_show_excluded, false)
  ), people as (
    select x.entity_id, x.contact_id, x.role, x.started_on
      from (
        select ce.entity_id, ce.contact_id, ce.role, ce.started_on
          from contact_entities ce join f on f.eid = ce.entity_id
         where ce.is_current
        union
        select c.entity_id, c.id, null::text, null::date
          from contacts c join f on f.eid = c.entity_id
         where not exists (select 1 from contact_entities x2
                            where x2.contact_id = c.id and x2.entity_id = c.entity_id and not x2.is_current)
      ) x
  ), best as (
    select distinct on (p.entity_id) p.entity_id, c.first_name, c.last_name, c.title, c.email,
           coalesce(c.phone, c.mobile_phone) as phone
      from people p join contacts c on c.id = p.contact_id
     order by p.entity_id,
              (coalesce(p.role, '') = 'Tenant Rep Broker'),
              (c.email is null),
              p.started_on desc nulls last,
              c.last_name
  )
  select f.eid, f.code, f.ename, f.category, f.cat_label, f.size_min_sf, f.size_max_sf,
         f.fit_v,
         case when f.fit_v <> 'close' then null
              when p_size < f.size_min_sf then round((f.size_min_sf - p_size) / p_size * 100)::int
              else -round((p_size - f.size_max_sf) / p_size * 100)::int end,
         f.drive_thru, f.facility_types, f.expansion_status, f.target_markets,
         f.target_markets <> '{}', f.needs_verification, f.last_verified_on,
         nullif(btrim(coalesce(bt.first_name, '') || ' ' || coalesce(bt.last_name, '')), ''),
         bt.title, bt.email, bt.phone,
         (select count(distinct p2.contact_id) from people p2 where p2.entity_id = f.eid)::int,
         (select count(*) from requirement_parties rp join requirements r on r.id = rp.requirement_id
           where rp.entity_id = f.eid and r.status = 'active')::int,
         count(*) over (),
         -- Last time anything about the brand changed: its CRM profile, the
         -- team's RTD edits, notes, contacts (drives "new since you last looked").
         greatest(f.updated_at,
                  (select max(l.updated_at) from rtd_layer l where l.kind = 'brand' and l.ref_id = f.eid),
                  (select max(n.created_at) from rtd_notes n where n.entity_id = f.eid and n.status <> 'removed'),
                  (select max(c.created_at) from rtd_changes c where c.entity_id = f.eid and c.status <> 'undone')),
         f.x_by,
         (select count(*) from f0 where f0.x_by is not null)::int
    from f
    left join best bt on bt.entity_id = f.eid
   order by (f.x_by is null),   -- shown only on request: excluded ones first, to check them
            case when coalesce(p_site, 'any') = 'has_drive_thru'
                 then case f.drive_thru when 'required' then 0 when 'preferred' then 1 else 2 end
                 else 0 end,
            case f.fit_v when 'fits' then 0 when 'close' then 1 else 2 end,
            f.needs_verification,
            f.last_verified_on desc nulls last,
            f.ename
   limit p_limit offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- ===========================================================================
-- 3. Saved searches
-- ===========================================================================

-- Params are kept to a known shape so a saved search always re-runs.
create or replace function rtd__clean_search_params(p jsonb)
returns jsonb
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_size numeric;
  v_cats jsonb;
  v_xcats jsonb;
  v_xwords jsonb;
begin
  p := coalesce(p, '{}'::jsonb);
  begin
    v_size := nullif(regexp_replace(coalesce(p->>'size', ''), '[^0-9.]', '', 'g'), '')::numeric;
  exception when others then v_size := null;
  end;
  if v_size is not null and v_size <= 0 then v_size := null; end if;
  select coalesce(jsonb_agg(distinct btrim(x)) filter (where btrim(x) <> ''), '[]'::jsonb)
    into v_cats
    from jsonb_array_elements_text(case jsonb_typeof(p->'categories') when 'array' then p->'categories' else '[]'::jsonb end) x;
  select coalesce(jsonb_agg(distinct btrim(x)) filter (where btrim(x) <> ''), '[]'::jsonb)
    into v_xcats
    from jsonb_array_elements_text(case jsonb_typeof(p->'exclude_categories') when 'array' then p->'exclude_categories' else '[]'::jsonb end) x;
  select coalesce(jsonb_agg(distinct lower(btrim(x))) filter (where length(btrim(x)) >= 2), '[]'::jsonb)
    into v_xwords
    from jsonb_array_elements_text(case jsonb_typeof(p->'exclude_words') when 'array' then p->'exclude_words' else '[]'::jsonb end) x;
  return jsonb_strip_nulls(jsonb_build_object(
    'size',       v_size,
    'market',     nullif(btrim(coalesce(p->>'market', '')), ''),
    'categories', v_cats,
    'site',       case when p->>'site' in ('has_drive_thru', 'no_drive_thru') then p->>'site' else 'any' end,
    'close',      coalesce((p->>'close')::boolean, true),
    'unverified', coalesce((p->>'unverified')::boolean, false),
    'unsized',    coalesce((p->>'unsized')::boolean, false),
    'q',          nullif(btrim(coalesce(p->>'q', '')), ''),
    'exclude_categories', v_xcats,
    'exclude_words',      v_xwords
  ));
end
$$;

-- Runs a saved search's params (as the signed-in person); ids + changed_at only.
drop function if exists rtd__run_search(jsonb);
create or replace function rtd__run_search(p jsonb)
returns table (entity_id uuid, changed_at timestamptz)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select r.entity_id, r.changed_at from rtd_search(
    (p->>'size')::numeric,
    p->>'market',
    (select string_agg(x, ',') from jsonb_array_elements_text(coalesce(p->'categories', '[]'::jsonb)) x),
    coalesce(p->>'site', 'any'),
    p->>'q',
    coalesce((p->>'close')::boolean, true),
    coalesce((p->>'unverified')::boolean, false),
    5000, 0,
    coalesce((p->>'unsized')::boolean, false),
    (select string_agg(x, ',') from jsonb_array_elements_text(coalesce(p->'exclude_categories', '[]'::jsonb)) x),
    (select string_agg(x, ',') from jsonb_array_elements_text(coalesce(p->'exclude_words', '[]'::jsonb)) x),
    false) r;
$$;

create or replace function rtd__saved_json(s rtd_saved_searches, me rtd_users, with_counts boolean)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_seen timestamptz;
  v_since timestamptz;
  v_total int;
  v_new int;
begin
  select viewed_at into v_seen from rtd_saved_search_views where search_id = s.id and user_id = me.id;
  -- Never opened it: "new" counts from when it was saved.
  v_since := coalesce(v_seen, s.created_at);
  if with_counts and s.params ? 'size' then
    select count(*), count(*) filter (where r.changed_at > v_since)
      into v_total, v_new
      from rtd__run_search(s.params) r;
  end if;
  return jsonb_build_object(
    'id', s.id, 'name', s.name, 'listing', s.listing, 'params', s.params,
    'created_by', (select display_name from rtd_users where id = s.created_by),
    'created_at', s.created_at,
    'updated_by', (select display_name from rtd_users where id = s.updated_by),
    'updated_at', s.updated_at,
    'mine', s.created_by = me.id,
    'can_edit', s.created_by = me.id or me.is_admin,
    'last_viewed_at', v_seen,
    'new_since', v_since,
    'total', v_total,
    'new_count', v_new);
end
$$;

-- Everyone's saved searches, newest first, with counts.
-- Grouped on the page by listing, then name.
create or replace function rtd_saved_searches()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me rtd_users := rtd_current_user();
begin
  return coalesce((
    select jsonb_agg(rtd__saved_json(s, me, true) order by lower(coalesce(s.listing, '~')), lower(s.name))
      from rtd_saved_searches s where s.deleted_at is null), '[]'::jsonb);
end
$$;

-- One saved search (no counts; the page runs the search itself).
create or replace function rtd_saved_search(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me rtd_users := rtd_current_user();
  s rtd_saved_searches;
begin
  select * into s from rtd_saved_searches where id = p_id and deleted_at is null;
  if not found then return null; end if;
  return rtd__saved_json(s, me, false);
end
$$;

drop function if exists rtd_save_search(text, jsonb);
drop function if exists rtd_update_saved_search(uuid, text, jsonb);
create or replace function rtd_save_search(p_name text, p_params jsonb, p_listing text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me rtd_users := rtd_current_user();
  v_params jsonb := rtd__clean_search_params(p_params);
  v_id uuid;
begin
  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'RTD: give the search a name' using errcode = '22023';
  end if;
  if not v_params ? 'size' then
    raise exception 'RTD: a saved search needs a size' using errcode = '22023';
  end if;
  insert into rtd_saved_searches (name, listing, params, created_by, updated_by)
  values (left(btrim(p_name), 120), nullif(left(btrim(coalesce(p_listing, '')), 120), ''), v_params, me.id, me.id)
  returning id into v_id;
  insert into rtd_saved_search_views (search_id, user_id, viewed_at) values (v_id, me.id, now());
  return jsonb_build_object('status', 'saved', 'id', v_id);
end
$$;

-- The person who saved it, or Dan. A null name or params keeps what's there.
-- p_listing: null keeps it, '' clears it.
create or replace function rtd_update_saved_search(p_id uuid, p_name text, p_params jsonb, p_listing text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me rtd_users := rtd_current_user();
  s rtd_saved_searches;
  v_params jsonb;
begin
  select * into s from rtd_saved_searches where id = p_id and deleted_at is null for update;
  if not found then raise exception 'RTD: that saved search is gone' using errcode = 'P0002'; end if;
  if s.created_by <> me.id and not me.is_admin then
    raise exception 'RTD: only % or Dan can change this saved search — save it as a new one instead',
      (select display_name from rtd_users where id = s.created_by) using errcode = '42501';
  end if;
  v_params := case when p_params is null then s.params else rtd__clean_search_params(p_params) end;
  if not v_params ? 'size' then
    raise exception 'RTD: a saved search needs a size' using errcode = '22023';
  end if;
  update rtd_saved_searches
     set name = coalesce(nullif(left(btrim(coalesce(p_name, '')), 120), ''), name),
         listing = case when p_listing is null then listing else nullif(left(btrim(p_listing), 120), '') end,
         params = v_params, updated_by = me.id, updated_at = now()
   where id = p_id;
  return jsonb_build_object('status', 'saved', 'id', p_id);
end
$$;

create or replace function rtd_delete_saved_search(p_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me rtd_users := rtd_current_user();
  s rtd_saved_searches;
begin
  select * into s from rtd_saved_searches where id = p_id and deleted_at is null for update;
  if not found then return jsonb_build_object('status', 'gone'); end if;
  if s.created_by <> me.id and not me.is_admin then
    raise exception 'RTD: only % or Dan can delete this saved search',
      (select display_name from rtd_users where id = s.created_by) using errcode = '42501';
  end if;
  update rtd_saved_searches set deleted_at = now(), deleted_by = me.id where id = p_id;
  return jsonb_build_object('status', 'deleted', 'id', p_id);
end
$$;

-- Opening a saved search resets that person's "new since" mark.
create or replace function rtd_mark_search_viewed(p_id uuid)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me rtd_users := rtd_current_user();
begin
  if not exists (select 1 from rtd_saved_searches where id = p_id and deleted_at is null) then return; end if;
  insert into rtd_saved_search_views (search_id, user_id, viewed_at) values (p_id, me.id, now())
  on conflict (search_id, user_id) do update set viewed_at = excluded.viewed_at;
end
$$;

-- ===========================================================================
-- 4. Grants
-- ===========================================================================
revoke execute on function rtd_search(numeric, text, text, text, text, boolean, boolean, int, int, boolean, text, text, boolean) from public, anon;
grant execute on function rtd_search(numeric, text, text, text, text, boolean, boolean, int, int, boolean, text, text, boolean) to authenticated;
revoke execute on function rtd_saved_searches(), rtd_saved_search(uuid), rtd_save_search(text, jsonb, text),
  rtd_update_saved_search(uuid, text, jsonb, text), rtd_delete_saved_search(uuid), rtd_mark_search_viewed(uuid)
  from public, anon;
grant execute on function rtd_saved_searches(), rtd_saved_search(uuid), rtd_save_search(text, jsonb, text),
  rtd_update_saved_search(uuid, text, jsonb, text), rtd_delete_saved_search(uuid), rtd_mark_search_viewed(uuid)
  to authenticated;
revoke execute on function rtd__clean_search_params(jsonb), rtd__run_search(jsonb),
  rtd__saved_json(rtd_saved_searches, rtd_users, boolean)
  from public, anon, authenticated;

commit;
