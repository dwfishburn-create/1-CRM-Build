-- CRM - Dan Fishburn — migration 028: RTD access (10/16/2026)
--
-- The RTD (Retail Tenant Directory) is its own app that reads this database
-- through a narrow window only. See CRM_Requirements_and_Decisions_Log.md,
-- 10/16/2026 entry. This migration does three things:
--
--   1. LOCKS DOWN the public schema for Supabase's browser-facing roles
--      (anon, authenticated). Until now nothing ever used the publishable key,
--      but every table, view and function still carried Supabase's default
--      grants to those roles. RLS kept the tables safe; the two VIEWS
--      (client_leases, retail_brand_directory) were NOT safe — a view runs as
--      its owner and skipped RLS, so anyone holding the publishable key could
--      read them — and every function was callable by anon (merge_entities,
--      the counters ...). Both sign-in pages now ship the publishable key to
--      browsers, so this closes all of that. The CRM itself is unaffected: it
--      reads and writes with the secret key (service_role), which keeps full
--      rights and bypasses RLS.
--
--   2. rtd_users — who may use the RTD (Dan, Jami Heidemann, Trey Brown),
--      matched on the signed-in email.
--
--   3. The narrow window: SECURITY DEFINER functions the RTD calls with the
--      signed-in user's own session. They return brand-directory data only
--      (brand profile, the brand's contacts and job links, the structured
--      fields of requirements linked to the brand). They never return
--      deals/projects, pipeline, leases, comps, tasks, activity, or the
--      free-text notes on entities, contacts or requirements. Each one
--      refuses unless the caller's email is an active rtd_users row.
--
-- Paste into the Supabase SQL editor and use "Run without RLS". Then run
--   notify pgrst, 'reload schema';
-- Re-runnable.

begin;

-- ===========================================================================
-- 1. Lock down anon / authenticated
-- ===========================================================================

-- Belt and braces: RLS on every public table (all already have it as of 026).
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end
$$;

revoke all     on all tables    in schema public from anon, authenticated;
revoke all     on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant all     on all tables    in schema public to service_role;
grant all     on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Views respect the caller's rights from now on (the CRM's service_role still
-- sees everything; anything else sees nothing).
alter view if exists public.client_leases          set (security_invoker = on);
alter view if exists public.retail_brand_directory set (security_invoker = on);

-- Objects created later (by the SQL editor's postgres role) get no browser grants.
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public grant all on tables    to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

-- ===========================================================================
-- 2. rtd_users
-- ===========================================================================
create table if not exists rtd_users (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  display_name text not null,
  contact_id   uuid references contacts(id) on delete set null,
  is_admin     boolean not null default false,   -- Dan: review queue, release any claim
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists idx_rtd_users_email on rtd_users (lower(email));
alter table rtd_users enable row level security;

insert into rtd_users (email, display_name, contact_id, is_admin)
select v.email, v.display_name,
       (select c.id from contacts c where c.display_code = v.code),
       v.is_admin
  from (values
    ('dwfishburn@gmail.com',      'Dan Fishburn',   null,       true),
    ('jami.heidemann@cbre.com',   'Jami Heidemann', 'CON-0013', false),
    ('trey.brown2@cbre.com',      'Trey Brown',     'CON-0113', false)
  ) v(email, display_name, code, is_admin)
 where not exists (select 1 from rtd_users u where lower(u.email) = lower(v.email));

-- ===========================================================================
-- 3. The narrow window
-- ===========================================================================

-- Who is calling? The signed-in user's email comes from Supabase Auth's JWT.
create or replace function rtd_current_user()
returns rtd_users
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  u rtd_users;
begin
  if v_email = '' then
    raise exception 'RTD: not signed in' using errcode = '42501';
  end if;
  select * into u from rtd_users where lower(email) = v_email and active;
  if not found then
    raise exception 'RTD: % is not on the RTD access list', v_email using errcode = '42501';
  end if;
  return u;
end
$$;

-- The RTD sign-in page asks this before emailing a link, so strangers never
-- get one. Callable without signing in; it answers yes/no for one address only.
create or replace function rtd_email_allowed(p_email text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from rtd_users where lower(email) = lower(btrim(coalesce(p_email, ''))) and active);
$$;

create or replace function rtd_me()
returns table (email text, display_name text, is_admin boolean)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select u.email, u.display_name, u.is_admin from rtd_current_user() u;
$$;

create or replace function rtd_categories()
returns table (code text, label text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform rtd_current_user();
  return query
    select rc.code, rc.label from retail_categories rc where rc.active order by rc.sort_order, rc.label;
end
$$;

-- "Fits this space." p_size in SF; a brand fits when the size is inside its
-- range (an open end counts as no limit) and is "close" when the range misses
-- it by no more than 15% of the searched size.
-- Markets: a brand with target markets set must include p_market; a brand with
-- none set yet (every RealNex brand today) still shows, marked market_set = false.
-- p_site: 'any' | 'has_drive_thru' | 'no_drive_thru' (the latter drops brands
-- that require one).
create or replace function rtd_search(
  p_size            numeric default null,
  p_market          text    default null,
  p_category        text    default null,
  p_site            text    default 'any',
  p_q               text    default null,
  p_include_close   boolean default true,
  p_unverified_only boolean default false,
  p_limit           int     default 100,
  p_offset          int     default 0
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
  total_count        bigint
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
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
           end as fit_v
      from retail_brands rb
      join entities e on e.id = rb.entity_id
      left join retail_categories rc on rc.code = rb.category
     where (p_category is null or p_category = '' or rb.category = p_category)
       and (p_market is null or p_market = '' or rb.target_markets = '{}'
            or p_market = any (rb.target_markets))
       and (coalesce(p_site, 'any') <> 'no_drive_thru' or rb.drive_thru is distinct from 'required')
       and (not coalesce(p_unverified_only, false) or rb.needs_verification)
       and (v_q is null or e.name ilike '%' || v_q || '%' or e.trade_name ilike '%' || v_q || '%')
  ), f as (
    select * from b
     where fit_v in ('none', 'fits') or (fit_v = 'close' and coalesce(p_include_close, true))
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
         case when f.fit_v = 'none' then 'none' else f.fit_v end,
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
         count(*) over ()
    from f
    left join best bt on bt.entity_id = f.eid
   order by case f.fit_v when 'fits' then 0 when 'close' then 1 else 2 end,
            f.needs_verification,
            f.last_verified_on desc nulls last,
            f.ename
   limit p_limit offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- One brand: profile, contacts (current and former), linked requirements
-- (structured fields only — never the free-text details), location count.
create or replace function rtd_brand(p_entity_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  perform rtd_current_user();

  select jsonb_build_object(
    'entity_id', e.id, 'display_code', e.display_code, 'name', e.name,
    'trade_name', e.trade_name, 'website', e.website,
    'category', rb.category, 'category_label', rc.label, 'category_detail', rb.category_detail,
    'size_min_sf', rb.size_min_sf, 'size_max_sf', rb.size_max_sf,
    'frontage_min_ft', rb.frontage_min_ft, 'drive_thru', rb.drive_thru,
    'facility_types', to_jsonb(rb.facility_types), 'site_criteria', rb.site_criteria,
    'operating_model', rb.operating_model, 'expansion_status', rb.expansion_status,
    'target_markets', to_jsonb(rb.target_markets),
    'needs_verification', rb.needs_verification, 'last_verified_on', rb.last_verified_on,
    'verification_note', rb.verification_note, 'profile_notes', rb.notes,
    'source_system', rb.source_system, 'profile_created_at', rb.created_at,
    'profile_updated_at', rb.updated_at,
    'metro_locations', (select count(distinct x.property_id) from (
        select pt.property_id from property_tenant pt where pt.entity_id = e.id and pt.is_current
        union
        select s.property_id from leases l join spaces s on s.id = l.space_id
         where l.tenant_entity_id = e.id and l.is_current) x),
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'contact_id', c.id, 'name', btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
               'title', c.title, 'email', c.email, 'phone', c.phone, 'mobile', c.mobile_phone,
               'role', p.role, 'is_current', p.is_current, 'ended_on', p.ended_on)
             order by p.is_current desc, (coalesce(p.role, '') = 'Tenant Rep Broker'), c.last_name)
        from (
          select ce.contact_id, ce.role, ce.is_current, ce.ended_on
            from contact_entities ce where ce.entity_id = e.id
          union
          select c2.id, null, true, null
            from contacts c2
           where c2.entity_id = e.id
             and not exists (select 1 from contact_entities x where x.contact_id = c2.id and x.entity_id = e.id)
        ) p join contacts c on c.id = p.contact_id), '[]'::jsonb),
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'display_code', r.display_code, 'deal_type', r.deal_type, 'property_type', r.property_type,
               'size_min', r.size_min, 'size_max', r.size_max, 'target_markets', to_jsonb(r.target_markets),
               'timeline', r.timeline, 'status', r.status, 'confidence', r.confidence,
               'source_date', r.source_date, 'reconfirm_date', r.reconfirm_date)
             order by (r.status = 'active') desc, r.reconfirm_date nulls last)
        from requirement_parties rp join requirements r on r.id = rp.requirement_id
       where rp.entity_id = e.id), '[]'::jsonb)
  )
  into v
  from retail_brands rb
  join entities e on e.id = rb.entity_id
  left join retail_categories rc on rc.code = rb.category
  where e.id = p_entity_id;

  return v;   -- null when the entity has no brand profile
end
$$;

revoke execute on function rtd_current_user()  from public, anon, authenticated;
revoke execute on function rtd_email_allowed(text) from public;
revoke execute on function rtd_me()            from public, anon;
revoke execute on function rtd_categories()    from public, anon;
revoke execute on function rtd_search(numeric, text, text, text, text, boolean, boolean, int, int) from public, anon;
revoke execute on function rtd_brand(uuid)     from public, anon;

grant execute on function rtd_email_allowed(text) to anon, authenticated;
grant execute on function rtd_me()             to authenticated;
grant execute on function rtd_categories()     to authenticated;
grant execute on function rtd_search(numeric, text, text, text, text, boolean, boolean, int, int) to authenticated;
grant execute on function rtd_brand(uuid)      to authenticated;

commit;
