-- 029_rtd_collaboration.sql — RTD build session 2 (10/19/2026)
--
-- Adds what Dan, Jami and Trey DO in the RTD, on top of 028's read-only window:
--   * intel notes (phone-first), seen by all three immediately;
--   * edits to a brand's profile, "still current" verifications, new contacts,
--     contact updates / "no longer there", new brands;
--   * Claim as my client (honor system; Dan's CRM clients claimed automatically);
--   * Dan's review queue: Accept / Reject / Leave, in the app or from Excel;
--   * What's new;
--   * Requirements (section 8, added 10/20/2026): any property type, added and
--     updated from the RTD; a CRM requirement appears only after Dan shares it.
--
-- Rules (decisions log, 10/16/2026):
--   * Everything is stamped with who (the signed-in email's rtd_users row),
--     when, field, old value and new value.
--   * The RTD always shows the CRM's live brand data. A colleague's edit, new
--     brand or new contact waits in Dan's queue; Dan's own goes straight in.
--   * Accept writes through the duplicate gate (find_similar_entities /
--     find_similar_contacts, blocking at 0.8 like the CRM's API) and issues
--     display codes with next_display_code.
--   * Accepted notes become CRM activity_log rows credited to the colleague.
--   * Conflicts are flagged, never overwritten: if the CRM value changed since
--     the edit was proposed, Accept refuses unless Dan says "accept anyway".
--   * Claim is a label only. One active claim per brand; only the holder or
--     Dan releases it. Auto-claims follow the CRM and can't be released here.
--
-- New tables have RLS on and no browser grants (028's default privileges).
-- Every function is SECURITY DEFINER and starts with rtd_current_user().
-- Re-runnable: create if not exists / create or replace throughout.

begin;

-- ===========================================================================
-- 1. Tables
-- ===========================================================================
create table if not exists rtd_notes (
  id               uuid primary key default gen_random_uuid(),
  entity_id        uuid not null references entities(id) on delete cascade,
  author_id        uuid not null references rtd_users(id),
  body             text not null check (length(btrim(body)) between 1 and 4000),
  tags             text[] not null default '{}',
  created_at       timestamptz not null default now(),
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  reviewed_at      timestamptz,
  reviewed_by      uuid references rtd_users(id),
  activity_log_id  uuid references activity_log(id) on delete set null
);
create index if not exists idx_rtd_notes_entity on rtd_notes (entity_id, created_at desc);
create index if not exists idx_rtd_notes_status on rtd_notes (status) where status = 'pending';
alter table rtd_notes enable row level security;

-- One row per proposal. kind:
--   brand_edit     new_value / old_value = {field: value, ...}
--   verify         payload = {note}
--   new_contact    payload = {first_name, last_name, title, email, phone, mobile_phone, role}
--   contact_update payload = {contact_id}; new_value / old_value = {field: value}
--   contact_left   payload = {contact_id, note}
--   new_brand      payload = {name, website, ...brand fields}; entity_id null until accepted
--   new_requirement     payload = {entity_id | party_name, ...requirement fields}; + requirement_id once accepted
--   requirement_update  payload = {requirement_id}; new_value / old_value = {field: value}
create table if not exists rtd_changes (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid references entities(id) on delete cascade,
  kind         text not null check (kind in ('brand_edit', 'verify', 'new_contact', 'contact_update', 'contact_left', 'new_brand',
                                         'new_requirement', 'requirement_update')),
  old_value    jsonb,
  new_value    jsonb,
  payload      jsonb not null default '{}'::jsonb,
  author_id    uuid not null references rtd_users(id),
  created_at   timestamptz not null default now(),
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  reviewed_at  timestamptz,
  reviewed_by  uuid references rtd_users(id),
  result_ref   text,     -- display code / id written on accept (ENT-…, CON-…)
  review_note  text
);
create index if not exists idx_rtd_changes_entity on rtd_changes (entity_id, created_at desc);
create index if not exists idx_rtd_changes_status on rtd_changes (status) where status = 'pending';
alter table rtd_changes enable row level security;

create table if not exists rtd_claims (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid not null references entities(id) on delete cascade,
  claimed_by   uuid not null references rtd_users(id),
  claimed_at   timestamptz not null default now(),
  released_at  timestamptz,
  released_by  uuid references rtd_users(id)
);
create unique index if not exists idx_rtd_claims_active on rtd_claims (entity_id) where released_at is null;
alter table rtd_claims enable row level security;

revoke all on rtd_notes, rtd_changes, rtd_claims from anon, authenticated;

-- ===========================================================================
-- 2. Internal helpers (not callable from the browser)
-- ===========================================================================

-- The brand fields the RTD may edit, cleaned and checked. '' / null clears a
-- field (an array to empty, expansion_status to unknown). Raises on bad input
-- with a message the app shows as-is.
create or replace function rtd__clean_brand_fields(p jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  k text;
  v jsonb;
  t text;
  arr text[];
  out jsonb := '{}'::jsonb;
  allowed text[] := array['category', 'category_detail', 'size_min_sf', 'size_max_sf', 'frontage_min_ft',
                          'drive_thru', 'facility_types', 'site_criteria', 'operating_model',
                          'expansion_status', 'target_markets', 'website'];
begin
  if p is null or jsonb_typeof(p) <> 'object' then return out; end if;
  for k, v in select * from jsonb_each(p) loop
    if not k = any (allowed) then
      raise exception 'RTD: % can''t be edited here', k using errcode = '22023';
    end if;
    if k in ('facility_types', 'target_markets') then
      if v is null or jsonb_typeof(v) = 'null' then
        arr := '{}';
      elsif jsonb_typeof(v) = 'array' then
        select coalesce(array_agg(distinct btrim(x)) filter (where btrim(x) <> ''), '{}') into arr
          from jsonb_array_elements_text(v) x;
      else
        raise exception 'RTD: % must be a list', k using errcode = '22023';
      end if;
      if k = 'facility_types' and not arr <@ array['free_standing', 'end_cap', 'neighborhood_strip', 'regional_strip',
             'power_center', 'lifestyle_center', 'regional_mall', 'outlet_mall', 'downtown', 'kiosk'] then
        raise exception 'RTD: unknown facility type' using errcode = '22023';
      end if;
      if k = 'target_markets' and not arr <@ array['omaha_metro', 'lincoln', 'greater_nebraska', 'cb_western_iowa'] then
        raise exception 'RTD: unknown market' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v from unnest(arr) x;
      out := out || jsonb_build_object(k, v);
      continue;
    end if;

    t := case when v is null or jsonb_typeof(v) = 'null' then null
              else nullif(btrim(replace(v #>> '{}', E'\r\n', E'\n')), '') end;

    if k in ('size_min_sf', 'size_max_sf', 'frontage_min_ft') then
      if t is not null then
        t := replace(replace(t, ',', ''), ' ', '');
        if t !~ '^[0-9]+(\.[0-9]+)?$' then
          raise exception 'RTD: % must be a number', replace(k, '_', ' ') using errcode = '22023';
        end if;
        out := out || jsonb_build_object(k, t::numeric);
      else
        out := out || jsonb_build_object(k, null);
      end if;
      continue;
    end if;

    if k = 'expansion_status' then
      t := coalesce(t, 'unknown');
      if t not in ('expanding', 'selective', 'not_expanding', 'contracting', 'unknown') then
        raise exception 'RTD: unknown expansion status' using errcode = '22023';
      end if;
    elsif k = 'drive_thru' and t is not null and t not in ('required', 'preferred', 'no') then
      raise exception 'RTD: drive-thru must be required, preferred or no' using errcode = '22023';
    elsif k = 'operating_model' and t is not null and t not in ('corporate', 'franchise', 'both') then
      raise exception 'RTD: operating model must be corporate, franchise or both' using errcode = '22023';
    elsif k = 'category' and t is not null
          and not exists (select 1 from retail_categories where code = t and active) then
      raise exception 'RTD: unknown category' using errcode = '22023';
    elsif k in ('site_criteria', 'category_detail') and length(coalesce(t, '')) > 4000 then
      raise exception 'RTD: % is too long', replace(k, '_', ' ') using errcode = '22023';
    elsif k = 'website' and length(coalesce(t, '')) > 300 then
      raise exception 'RTD: website is too long' using errcode = '22023';
    end if;
    out := out || jsonb_build_object(k, t);
  end loop;
  return out;
end
$$;

-- The current values of a brand's editable fields, same shape as the cleaner's output.
create or replace function rtd__brand_values(p_entity_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'category', rb.category, 'category_detail', rb.category_detail,
    'size_min_sf', rb.size_min_sf, 'size_max_sf', rb.size_max_sf, 'frontage_min_ft', rb.frontage_min_ft,
    'drive_thru', rb.drive_thru,
    'facility_types', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from unnest(rb.facility_types) x),
    'site_criteria', rb.site_criteria, 'operating_model', rb.operating_model,
    'expansion_status', rb.expansion_status,
    'target_markets', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from unnest(rb.target_markets) x),
    'website', e.website)
  from retail_brands rb join entities e on e.id = rb.entity_id
  where rb.entity_id = p_entity_id;
$$;

create or replace function rtd__clean_contact_fields(p jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  k text;
  v jsonb;
  t text;
  out jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return out; end if;
  for k, v in select * from jsonb_each(p) loop
    if not k = any (array['first_name', 'last_name', 'title', 'email', 'phone', 'mobile_phone', 'role']) then
      raise exception 'RTD: % can''t be set here', k using errcode = '22023';
    end if;
    t := case when v is null or jsonb_typeof(v) = 'null' then null else nullif(btrim(v #>> '{}'), '') end;
    if length(coalesce(t, '')) > 200 then
      raise exception 'RTD: % is too long', replace(k, '_', ' ') using errcode = '22023';
    end if;
    if k = 'email' and t is not null then
      t := lower(t);
      if t !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'RTD: that email address doesn''t look right' using errcode = '22023';
      end if;
    end if;
    out := out || jsonb_build_object(k, t);
  end loop;
  return out;
end
$$;

-- Two stored values are "the same" for change detection: strings compared
-- trimmed (a browser textarea sends \r\n), empty and null alike.
create or replace function rtd__same(a jsonb, b jsonb)
returns boolean
language sql immutable
as $$
  select coalesce(case when jsonb_typeof(a) = 'string' then to_jsonb(nullif(btrim(replace(a #>> '{}', E'\r\n', E'\n')), '')) else a end, 'null'::jsonb)
       = coalesce(case when jsonb_typeof(b) = 'string' then to_jsonb(nullif(btrim(replace(b #>> '{}', E'\r\n', E'\n')), '')) else b end, 'null'::jsonb);
$$;

-- Fields whose CRM value no longer matches what the proposer saw.
create or replace function rtd__conflicts(p_old jsonb, p_current jsonb)
returns text[]
language sql immutable
as $$
  select coalesce(array_agg(k order by k), '{}')
    from jsonb_object_keys(coalesce(p_old, '{}'::jsonb)) k
   where not rtd__same(p_old -> k, p_current -> k);
$$;

create or replace function rtd__contact_values(p_contact_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('first_name', c.first_name, 'last_name', c.last_name, 'title', c.title,
                            'email', c.email, 'phone', c.phone, 'mobile_phone', c.mobile_phone)
    from contacts c where c.id = p_contact_id;
$$;

-- Is this contact one of this brand's people? (Linked by job history or entity_id.)
create or replace function rtd__contact_on_brand(p_contact_id uuid, p_entity_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from contact_entities where contact_id = p_contact_id and entity_id = p_entity_id)
      or exists (select 1 from contacts where id = p_contact_id and entity_id = p_entity_id);
$$;

-- Write an accepted note into the CRM's activity log, credited to its author.
create or replace function rtd__note_to_crm(p_note_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  n rtd_notes;
  who text;
  v_id uuid;
begin
  select * into n from rtd_notes where id = p_note_id;
  if n.activity_log_id is not null then return n.activity_log_id; end if;
  select display_name into who from rtd_users where id = n.author_id;
  insert into activity_log (display_code, activity_type, activity_date, performed_by, summary, entity_id,
                            client_visible, source, source_system, source_record_id)
  values (next_display_code('activity_log', 'LOG'), 'Note', n.created_at, who,
          case when n.tags <> '{}' then '[' || array_to_string(n.tags, ', ') || '] ' else '' end
            || n.body || E'\n— RTD intel from ' || who,
          n.entity_id, false, 'rtd', 'rtd', n.id::text)
  returning id into v_id;
  update rtd_notes set activity_log_id = v_id where id = n.id;
  return v_id;
end
$$;

-- Apply one proposal to the CRM. Returns {status: applied | duplicate | conflict | gone, ...}.
-- Never raises for a business reason; database errors (a check constraint) do raise.
create or replace function rtd__apply(p_change_id uuid, p_force boolean default false, p_link_contact_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  c rtd_changes;
  who text;
  cur jsonb;
  conf text[];
  f jsonb;
  matches jsonb;
  v_entity uuid;
  v_contact uuid;
  v_code text;
  k text;
begin
  select * into c from rtd_changes where id = p_change_id for update;
  if not found or c.status <> 'pending' then
    return jsonb_build_object('status', 'gone', 'message', 'That item was already handled.');
  end if;
  select display_name into who from rtd_users where id = c.author_id;

  if c.kind in ('brand_edit', 'verify', 'new_contact', 'contact_update', 'contact_left')
     and not exists (select 1 from retail_brands where entity_id = c.entity_id) then
    return jsonb_build_object('status', 'gone', 'message', 'That brand is no longer in the directory.');
  end if;

  if c.kind = 'brand_edit' then
    cur := rtd__brand_values(c.entity_id);
    conf := rtd__conflicts(c.old_value, cur);
    if conf <> '{}' and not p_force then
      return jsonb_build_object('status', 'conflict', 'fields', to_jsonb(conf), 'current', cur,
        'message', 'The CRM changed since this was proposed: ' || array_to_string(array(select replace(x, '_', ' ') from unnest(conf) x), ', '));
    end if;
    f := c.new_value;
    if f ? 'website' then
      update entities set website = f ->> 'website', updated_at = now() where id = c.entity_id;
    end if;
    update retail_brands rb set
      category        = case when f ? 'category'        then f ->> 'category'                 else rb.category end,
      category_detail = case when f ? 'category_detail' then f ->> 'category_detail'          else rb.category_detail end,
      size_min_sf     = case when f ? 'size_min_sf'     then (f ->> 'size_min_sf')::numeric   else rb.size_min_sf end,
      size_max_sf     = case when f ? 'size_max_sf'     then (f ->> 'size_max_sf')::numeric   else rb.size_max_sf end,
      frontage_min_ft = case when f ? 'frontage_min_ft' then (f ->> 'frontage_min_ft')::numeric else rb.frontage_min_ft end,
      drive_thru      = case when f ? 'drive_thru'      then f ->> 'drive_thru'               else rb.drive_thru end,
      facility_types  = case when f ? 'facility_types'
                             then array(select jsonb_array_elements_text(f -> 'facility_types')) else rb.facility_types end,
      site_criteria   = case when f ? 'site_criteria'   then f ->> 'site_criteria'            else rb.site_criteria end,
      operating_model = case when f ? 'operating_model' then f ->> 'operating_model'          else rb.operating_model end,
      expansion_status = case when f ? 'expansion_status' then f ->> 'expansion_status'       else rb.expansion_status end,
      target_markets  = case when f ? 'target_markets'
                             then array(select jsonb_array_elements_text(f -> 'target_markets')) else rb.target_markets end
     where rb.entity_id = c.entity_id;
    return jsonb_build_object('status', 'applied');

  elsif c.kind = 'verify' then
    update retail_brands
       set needs_verification = false,
           last_verified_on = (c.created_at at time zone 'America/Chicago')::date,
           verification_note = 'Confirmed current in the RTD by ' || who
                               || coalesce(': ' || nullif(btrim(c.payload ->> 'note'), ''), '')
     where entity_id = c.entity_id;
    return jsonb_build_object('status', 'applied');

  elsif c.kind = 'new_contact' then
    f := c.payload;
    if p_link_contact_id is not null then
      -- Dan picked an existing person: link them to this brand instead of creating one.
      if not exists (select 1 from contacts where id = p_link_contact_id) then
        return jsonb_build_object('status', 'gone', 'message', 'That existing contact no longer exists.');
      end if;
      insert into contact_entities (contact_id, entity_id, role, is_current, source_system, source_record_id)
      values (p_link_contact_id, c.entity_id, f ->> 'role', true, 'rtd', c.id::text)
      on conflict (contact_id, entity_id) do update set is_current = true, ended_on = null,
        role = coalesce(contact_entities.role, excluded.role);
      select display_code into v_code from contacts where id = p_link_contact_id;
      return jsonb_build_object('status', 'applied', 'result_ref', v_code, 'linked', true);
    end if;
    if not p_force then
      select coalesce(jsonb_agg(m), '[]'::jsonb) into matches
        from jsonb_array_elements(find_similar_contacts(f ->> 'first_name', f ->> 'last_name', f ->> 'email', 5)) m
       where (m ->> 'score')::numeric >= 0.8;
      if jsonb_array_length(matches) > 0 then
        return jsonb_build_object('status', 'duplicate', 'matches', matches,
          'message', 'This looks like someone already in the CRM.');
      end if;
    end if;
    v_code := next_display_code('contacts', 'CON');
    insert into contacts (display_code, first_name, last_name, title, email, phone, mobile_phone, entity_id,
                          needs_verification, verification_note, source_system, source_record_id)
    values (v_code, f ->> 'first_name', f ->> 'last_name', f ->> 'title', f ->> 'email', f ->> 'phone',
            f ->> 'mobile_phone', c.entity_id, false,
            'Added in the RTD by ' || who || ' on ' || to_char(c.created_at at time zone 'America/Chicago', 'FMMM/FMDD/YYYY'),
            'rtd', c.id::text)
    returning id into v_contact;
    insert into contact_entities (contact_id, entity_id, role, is_current, source_system, source_record_id)
    values (v_contact, c.entity_id, f ->> 'role', true, 'rtd', c.id::text);
    return jsonb_build_object('status', 'applied', 'result_ref', v_code);

  elsif c.kind = 'contact_update' then
    v_contact := (c.payload ->> 'contact_id')::uuid;
    cur := rtd__contact_values(v_contact);
    if cur is null then
      return jsonb_build_object('status', 'gone', 'message', 'That contact no longer exists.');
    end if;
    conf := rtd__conflicts(c.old_value, cur);
    if conf <> '{}' and not p_force then
      return jsonb_build_object('status', 'conflict', 'fields', to_jsonb(conf), 'current', cur,
        'message', 'The CRM changed since this was proposed: ' || array_to_string(array(select replace(x, '_', ' ') from unnest(conf) x), ', '));
    end if;
    f := c.new_value;
    update contacts ct set
      first_name   = case when f ? 'first_name'   then f ->> 'first_name'   else ct.first_name end,
      last_name    = case when f ? 'last_name'    then f ->> 'last_name'    else ct.last_name end,
      title        = case when f ? 'title'        then f ->> 'title'        else ct.title end,
      email        = case when f ? 'email'        then f ->> 'email'        else ct.email end,
      phone        = case when f ? 'phone'        then f ->> 'phone'        else ct.phone end,
      mobile_phone = case when f ? 'mobile_phone' then f ->> 'mobile_phone' else ct.mobile_phone end,
      updated_at   = now()
     where ct.id = v_contact;
    select display_code into v_code from contacts where id = v_contact;
    return jsonb_build_object('status', 'applied', 'result_ref', v_code);

  elsif c.kind = 'contact_left' then
    v_contact := (c.payload ->> 'contact_id')::uuid;
    if not exists (select 1 from contacts where id = v_contact) then
      return jsonb_build_object('status', 'gone', 'message', 'That contact no longer exists.');
    end if;
    insert into contact_entities (contact_id, entity_id, is_current, ended_on, notes, source_system, source_record_id)
    values (v_contact, c.entity_id, false, (c.created_at at time zone 'America/Chicago')::date,
            'Reported gone in the RTD by ' || who || coalesce(': ' || nullif(btrim(c.payload ->> 'note'), ''), ''),
            'rtd', c.id::text)
    on conflict (contact_id, entity_id) do update
      set is_current = false,
          ended_on = coalesce(contact_entities.ended_on, excluded.ended_on),
          notes = concat_ws(E'\n', contact_entities.notes, excluded.notes);
    select display_code into v_code from contacts where id = v_contact;
    return jsonb_build_object('status', 'applied', 'result_ref', v_code);

  elsif c.kind = 'new_brand' then
    f := c.payload;
    if not p_force then
      select coalesce(jsonb_agg(m), '[]'::jsonb) into matches
        from jsonb_array_elements(find_similar_entities(f ->> 'name', 5)) m
       where (m ->> 'score')::numeric >= 0.8;
      if jsonb_array_length(matches) > 0 then
        return jsonb_build_object('status', 'duplicate', 'matches', matches,
          'message', 'This looks like a company already in the CRM.');
      end if;
    end if;
    v_code := next_display_code('entities', 'ENT');
    insert into entities (display_code, name, entity_type, website, source_system, source_record_id)
    values (v_code, f ->> 'name', 'Tenant', nullif(f ->> 'website', ''), 'rtd', c.id::text)
    returning id into v_entity;
    insert into retail_brands (entity_id, category, category_detail, size_min_sf, size_max_sf, frontage_min_ft,
                               drive_thru, facility_types, site_criteria, operating_model, expansion_status,
                               target_markets, needs_verification, last_verified_on, verification_note,
                               source_system, source_record_id)
    values (v_entity, f ->> 'category', f ->> 'category_detail', (f ->> 'size_min_sf')::numeric,
            (f ->> 'size_max_sf')::numeric, (f ->> 'frontage_min_ft')::numeric, f ->> 'drive_thru',
            coalesce(array(select jsonb_array_elements_text(f -> 'facility_types')), '{}'),
            f ->> 'site_criteria', f ->> 'operating_model', coalesce(f ->> 'expansion_status', 'unknown'),
            coalesce(array(select jsonb_array_elements_text(f -> 'target_markets')), '{}'),
            false, (c.created_at at time zone 'America/Chicago')::date, 'Added in the RTD by ' || who,
            'rtd', c.id::text);
    update rtd_changes set entity_id = v_entity where id = c.id;
    -- Anything else proposed against this pending brand (none today) would follow it.
    return jsonb_build_object('status', 'applied', 'result_ref', v_code, 'entity_id', v_entity);

  elsif c.kind in ('new_requirement', 'requirement_update') then
    return rtd__apply_requirement(c, p_force, p_link_contact_id);
  end if;

  return jsonb_build_object('status', 'gone', 'message', 'Unknown kind ' || c.kind);
end
$$;

-- Store a proposal; for Dan, apply it at once (a duplicate or error leaves nothing behind).
create or replace function rtd__submit(p_kind text, p_entity_id uuid, p_old jsonb, p_new jsonb, p_payload jsonb,
                                       p_force boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
  v_id uuid;
  r jsonb;
begin
  insert into rtd_changes (entity_id, kind, old_value, new_value, payload, author_id)
  values (p_entity_id, p_kind, p_old, p_new, coalesce(p_payload, '{}'::jsonb), u.id)
  returning id into v_id;

  if not u.is_admin then
    return jsonb_build_object('status', 'pending', 'id', v_id);
  end if;

  r := rtd__apply(v_id, p_force);
  if r ->> 'status' = 'applied' then
    update rtd_changes set status = 'accepted', reviewed_at = now(), reviewed_by = u.id,
                           result_ref = r ->> 'result_ref'
     where id = v_id;
    return r || jsonb_build_object('id', v_id);
  end if;
  delete from rtd_changes where id = v_id;
  return r;
end
$$;

revoke execute on function rtd__clean_brand_fields(jsonb)            from public, anon, authenticated;
revoke execute on function rtd__brand_values(uuid)                   from public, anon, authenticated;
revoke execute on function rtd__clean_contact_fields(jsonb)          from public, anon, authenticated;
revoke execute on function rtd__conflicts(jsonb, jsonb)              from public, anon, authenticated;
revoke execute on function rtd__same(jsonb, jsonb)                   from public, anon, authenticated;
revoke execute on function rtd__contact_values(uuid)                 from public, anon, authenticated;
revoke execute on function rtd__contact_on_brand(uuid, uuid)         from public, anon, authenticated;
revoke execute on function rtd__note_to_crm(uuid)                    from public, anon, authenticated;
revoke execute on function rtd__apply(uuid, boolean, uuid)           from public, anon, authenticated;
revoke execute on function rtd__submit(text, uuid, jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;

-- ===========================================================================
-- 3. Claims
-- ===========================================================================

-- Who holds each brand: a manual RTD claim, or Dan automatically when the brand
-- is the client on an active or won CRM project. Only names and dates leave.
create or replace function rtd__claims_for(p_entity_ids uuid[])
returns table (entity_id uuid, holder text, holder_is_me boolean, since date, auto boolean)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
  dan text := coalesce((select display_name from rtd_users where is_admin and active order by created_at limit 1), 'Dan Fishburn');
  dan_id uuid := (select id from rtd_users where is_admin and active order by created_at limit 1);
begin
  return query
  with ids as (select distinct unnest(p_entity_ids) as eid),
  manual as (
    select cl.entity_id, ru.display_name, (cl.claimed_by = u.id) as mine,
           (cl.claimed_at at time zone 'America/Chicago')::date as since
      from rtd_claims cl join ids on ids.eid = cl.entity_id
      join rtd_users ru on ru.id = cl.claimed_by
     where cl.released_at is null
  ),
  crm as (
    select p.client_entity_id as entity_id,
           min(coalesce(p.start_date, (p.created_at at time zone 'America/Chicago')::date)) as since
      from projects p join ids on ids.eid = p.client_entity_id
     where p.status in ('active', 'closed_won')
     group by p.client_entity_id
  )
  select ids.eid,
         coalesce(m.display_name, case when a.entity_id is not null then dan end),
         coalesce(m.mine, a.entity_id is not null and u.id = dan_id),
         coalesce(m.since, a.since),
         m.entity_id is null and a.entity_id is not null
    from ids
    left join manual m on m.entity_id = ids.eid
    left join crm a on a.entity_id = ids.eid
   where m.entity_id is not null or a.entity_id is not null;
end
$$;
revoke execute on function rtd__claims_for(uuid[]) from public, anon, authenticated;

create or replace function rtd_claims_for(p_entity_ids uuid[])
returns table (entity_id uuid, holder text, holder_is_me boolean, since date, auto boolean)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select * from rtd__claims_for(p_entity_ids);
$$;

create or replace function rtd_claim(p_entity_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
  h record;
begin
  if not exists (select 1 from retail_brands where entity_id = p_entity_id) then
    raise exception 'RTD: that brand isn''t in the directory' using errcode = '22023';
  end if;
  select * into h from rtd__claims_for(array[p_entity_id]);
  if found then
    if h.holder_is_me then
      return jsonb_build_object('status', 'already_yours');
    end if;
    raise exception 'RTD: already claimed as a client by %, since %', h.holder, to_char(h.since, 'FMMM/FMDD/YYYY')
      using errcode = '23505';
  end if;
  begin
    insert into rtd_claims (entity_id, claimed_by) values (p_entity_id, u.id);
  exception when unique_violation then
    raise exception 'RTD: someone claimed this brand a moment ago — reload to see who' using errcode = '23505';
  end;
  return jsonb_build_object('status', 'claimed');
end
$$;

create or replace function rtd_release(p_entity_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
  cl rtd_claims;
begin
  select * into cl from rtd_claims where entity_id = p_entity_id and released_at is null for update;
  if not found then
    if exists (select 1 from projects where client_entity_id = p_entity_id and status in ('active', 'closed_won')) then
      raise exception 'RTD: this claim comes from a CRM project and follows it — close the project in the CRM to release it'
        using errcode = '42501';
    end if;
    return jsonb_build_object('status', 'not_claimed');
  end if;
  if cl.claimed_by <> u.id and not u.is_admin then
    raise exception 'RTD: only the person who claimed it, or Dan, can release it' using errcode = '42501';
  end if;
  update rtd_claims set released_at = now(), released_by = u.id where id = cl.id;
  return jsonb_build_object('status', 'released');
end
$$;

-- ===========================================================================
-- 4. Notes, edits, verifications, contacts, new brands
-- ===========================================================================
create or replace function rtd_add_note(p_entity_id uuid, p_body text, p_tags text[] default '{}')
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
  v_id uuid;
  v_tags text[];
begin
  if not exists (select 1 from retail_brands where entity_id = p_entity_id) then
    raise exception 'RTD: that brand isn''t in the directory' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'RTD: write a note first' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct t), '{}') into v_tags
    from unnest(coalesce(p_tags, '{}')) t
   where t in ('Expanding', 'Not expanding', 'Closing stores', 'Looking here', 'Signed a deal', 'New contact', 'Talked to them');
  insert into rtd_notes (entity_id, author_id, body, tags)
  values (p_entity_id, u.id, btrim(p_body), v_tags)
  returning id into v_id;
  if u.is_admin then
    perform rtd__note_to_crm(v_id);
    update rtd_notes set status = 'accepted', reviewed_at = now(), reviewed_by = u.id where id = v_id;
    return jsonb_build_object('status', 'accepted', 'id', v_id);
  end if;
  return jsonb_build_object('status', 'pending', 'id', v_id);
end
$$;

-- p_fields: only the fields being changed, e.g. {"size_min_sf": 2000, "expansion_status": "expanding"}.
create or replace function rtd_propose_edit(p_entity_id uuid, p_fields jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  cur jsonb;
  f jsonb;
  newv jsonb := '{}'::jsonb;
  oldv jsonb := '{}'::jsonb;
  k text;
  smin numeric;
  smax numeric;
begin
  perform rtd_current_user();
  cur := rtd__brand_values(p_entity_id);
  if cur is null then
    raise exception 'RTD: that brand isn''t in the directory' using errcode = '22023';
  end if;
  f := rtd__clean_brand_fields(p_fields);
  for k in select jsonb_object_keys(f) loop
    if not rtd__same(f -> k, cur -> k) then
      newv := newv || jsonb_build_object(k, f -> k);
      oldv := oldv || jsonb_build_object(k, cur -> k);
    end if;
  end loop;
  if newv = '{}'::jsonb then
    return jsonb_build_object('status', 'no_change');
  end if;
  smin := coalesce((case when newv ? 'size_min_sf' then newv else cur end) ->> 'size_min_sf', null)::numeric;
  smax := coalesce((case when newv ? 'size_max_sf' then newv else cur end) ->> 'size_max_sf', null)::numeric;
  if smin is not null and smax is not null and smin > smax then
    raise exception 'RTD: the minimum size is larger than the maximum' using errcode = '22023';
  end if;
  return rtd__submit('brand_edit', p_entity_id, oldv, newv, '{}'::jsonb);
end
$$;

create or replace function rtd_mark_verified(p_entity_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform rtd_current_user();
  if not exists (select 1 from retail_brands where entity_id = p_entity_id) then
    raise exception 'RTD: that brand isn''t in the directory' using errcode = '22023';
  end if;
  return rtd__submit('verify', p_entity_id, null, null,
                     jsonb_build_object('note', left(nullif(btrim(coalesce(p_note, '')), ''), 500)));
end
$$;

-- p_contact: {first_name, last_name, title, email, phone, mobile_phone, role}.
create or replace function rtd_add_contact(p_entity_id uuid, p_contact jsonb, p_force boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  f jsonb;
begin
  perform rtd_current_user();
  if not exists (select 1 from retail_brands where entity_id = p_entity_id) then
    raise exception 'RTD: that brand isn''t in the directory' using errcode = '22023';
  end if;
  f := rtd__clean_contact_fields(p_contact);
  if f ->> 'first_name' is null and f ->> 'last_name' is null then
    raise exception 'RTD: a contact needs a name' using errcode = '22023';
  end if;
  if f ->> 'email' is null and f ->> 'phone' is null and f ->> 'mobile_phone' is null then
    raise exception 'RTD: add an email or a phone number' using errcode = '22023';
  end if;
  return rtd__submit('new_contact', p_entity_id, null, null, f, p_force);
end
$$;

create or replace function rtd_update_contact(p_entity_id uuid, p_contact_id uuid, p_fields jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  cur jsonb;
  f jsonb;
  newv jsonb := '{}'::jsonb;
  oldv jsonb := '{}'::jsonb;
  k text;
begin
  perform rtd_current_user();
  if not rtd__contact_on_brand(p_contact_id, p_entity_id) then
    raise exception 'RTD: that person isn''t linked to this brand' using errcode = '22023';
  end if;
  cur := rtd__contact_values(p_contact_id);
  f := rtd__clean_contact_fields(p_fields) - 'role';
  for k in select jsonb_object_keys(f) loop
    if not rtd__same(f -> k, cur -> k) then
      newv := newv || jsonb_build_object(k, f -> k);
      oldv := oldv || jsonb_build_object(k, cur -> k);
    end if;
  end loop;
  if newv = '{}'::jsonb then
    return jsonb_build_object('status', 'no_change');
  end if;
  return rtd__submit('contact_update', p_entity_id, oldv, newv, jsonb_build_object('contact_id', p_contact_id));
end
$$;

create or replace function rtd_contact_left(p_entity_id uuid, p_contact_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform rtd_current_user();
  if not rtd__contact_on_brand(p_contact_id, p_entity_id) then
    raise exception 'RTD: that person isn''t linked to this brand' using errcode = '22023';
  end if;
  return rtd__submit('contact_left', p_entity_id, null, null,
                     jsonb_build_object('contact_id', p_contact_id,
                                        'note', left(nullif(btrim(coalesce(p_note, '')), ''), 500)));
end
$$;

-- Before adding a brand: directory brands with a similar name (never other CRM companies).
create or replace function rtd_brand_lookalikes(p_name text)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform rtd_current_user();
  if length(btrim(coalesce(p_name, ''))) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('entity_id', m ->> 'id', 'name', m ->> 'name',
                                        'score', (m ->> 'score')::numeric, 'reason', m ->> 'reason'))
      from jsonb_array_elements(find_similar_entities(btrim(p_name), 8)) m
     where (m ->> 'score')::numeric >= 0.6
       and exists (select 1 from retail_brands rb where rb.entity_id = (m ->> 'id')::uuid)), '[]'::jsonb);
end
$$;

-- p_brand: {name, website, category, size_min_sf, ...any editable brand field}.
create or replace function rtd_add_brand(p_brand jsonb, p_force boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := nullif(btrim(coalesce(p_brand ->> 'name', '')), '');
  f jsonb;
begin
  perform rtd_current_user();
  if v_name is null then
    raise exception 'RTD: a brand needs a name' using errcode = '22023';
  end if;
  if length(v_name) > 200 then
    raise exception 'RTD: that name is too long' using errcode = '22023';
  end if;
  f := rtd__clean_brand_fields(p_brand - 'name');
  if (f ->> 'size_min_sf')::numeric > (f ->> 'size_max_sf')::numeric then
    raise exception 'RTD: the minimum size is larger than the maximum' using errcode = '22023';
  end if;
  if exists (select 1 from rtd_changes where kind = 'new_brand' and status = 'pending'
              and lower(payload ->> 'name') = lower(v_name)) then
    raise exception 'RTD: % is already waiting for Dan''s review', v_name using errcode = '23505';
  end if;
  return rtd__submit('new_brand', null, null, null, f || jsonb_build_object('name', v_name), p_force);
end
$$;

-- ===========================================================================
-- 5. Reading: a brand's RTD activity, What's new
-- ===========================================================================
create or replace function rtd__who(p_id uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$ select display_name from rtd_users where id = p_id $$;
revoke execute on function rtd__who(uuid) from public, anon, authenticated;

-- Everything the RTD knows about a brand beyond rtd_brand: claim, notes,
-- pending proposals (visible to all three) and history (accepted / rejected).
create or replace function rtd_brand_activity(p_entity_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
begin
  return jsonb_build_object(
    'me', jsonb_build_object('is_admin', u.is_admin, 'display_name', u.display_name),
    'claim', (select to_jsonb(c) from rtd__claims_for(array[p_entity_id]) c limit 1),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'author', rtd__who(n.author_id), 'mine', n.author_id = u.id,
                                          'body', n.body, 'tags', to_jsonb(n.tags), 'created_at', n.created_at,
                                          'status', n.status) order by n.created_at desc)
        from rtd_notes n where n.entity_id = p_entity_id), '[]'::jsonb),
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'author', rtd__who(c.author_id),
                                          'created_at', c.created_at, 'old_value', c.old_value,
                                          'new_value', c.new_value, 'payload', c.payload,
                                          'contact_name', (select btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, ''))
                                                             from contacts ct where ct.id = (c.payload ->> 'contact_id')::uuid))
                       order by c.created_at desc)
        from rtd_changes c where c.entity_id = p_entity_id and c.status = 'pending'), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h.x order by h.at desc) from (
        select * from (
          select c.created_at as at,
                 jsonb_build_object('at', c.created_at, 'kind', c.kind, 'status', c.status,
                                    'author', rtd__who(c.author_id), 'reviewed_by', rtd__who(c.reviewed_by),
                                    'old_value', c.old_value, 'new_value', c.new_value, 'payload', c.payload,
                                    'result_ref', c.result_ref,
                                    'contact_name', (select btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, ''))
                                                       from contacts ct where ct.id = (c.payload ->> 'contact_id')::uuid)) as x
            from rtd_changes c where c.entity_id = p_entity_id and c.status <> 'pending'
          union all
          select cl.claimed_at, jsonb_build_object('at', cl.claimed_at, 'kind', 'claim', 'status', 'accepted',
                                                   'author', rtd__who(cl.claimed_by))
            from rtd_claims cl where cl.entity_id = p_entity_id
          union all
          select cl.released_at, jsonb_build_object('at', cl.released_at, 'kind', 'release', 'status', 'accepted',
                                                    'author', rtd__who(cl.released_by))
            from rtd_claims cl where cl.entity_id = p_entity_id and cl.released_at is not null
        ) all_h order by all_h.at desc limit 50) h), '[]'::jsonb),
    'verified_by', (
      select rtd__who(c.author_id) from rtd_changes c
       where c.entity_id = p_entity_id and c.kind = 'verify' and c.status = 'accepted'
       order by c.created_at desc limit 1)
  );
end
$$;

-- "10,000–15,000 SF", "50,000+ SF", "up to 2,000 SF", or null.
create or replace function rtd__sf_range(a numeric, b numeric)
returns text
language sql immutable
as $$
  select case
    when a is null and b is null then null
    when b is null then to_char(a, 'FM999,999,999') || '+ SF'
    when a is null then 'up to ' || to_char(b, 'FM999,999,999') || ' SF'
    when a = b then to_char(a, 'FM999,999,999') || ' SF'
    else to_char(a, 'FM999,999,999') || '–' || to_char(b, 'FM999,999,999') || ' SF' end;
$$;
revoke execute on function rtd__sf_range(numeric, numeric) from public, anon, authenticated;

-- Recent happenings across the directory, newest first.
-- kind: note | verified | edit | expanding | new_contact | contact_left | new_brand | requirement | claim | release
create or replace function rtd_whats_new(p_days int default 30)
returns table (at timestamptz, kind text, entity_id uuid, brand text, who text, detail text, status text, requirement_id uuid)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  since timestamptz;
begin
  perform rtd_current_user();
  since := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  return query
  select * from (
    select n.created_at, 'note'::text, n.entity_id, e.name, rtd__who(n.author_id),
           left(case when n.tags <> '{}' then '[' || array_to_string(n.tags, ', ') || '] ' else '' end || n.body, 240),
           n.status, null::uuid
      from rtd_notes n join entities e on e.id = n.entity_id
     where n.created_at >= since
    union all
    select c.created_at,
           case c.kind
             when 'brand_edit' then case when c.new_value ->> 'expansion_status' = 'expanding' then 'expanding' else 'edit' end
             when 'verify' then 'verified'
             when 'new_requirement' then 'requirement'
             when 'requirement_update' then 'requirement_edit'
             else c.kind end,
           c.entity_id, coalesce(e.name, c.payload ->> 'name', c.payload ->> 'party_name',
                                 (select pty.name from rtd__req_party((c.payload ->> 'requirement_id')::uuid) pty)), rtd__who(c.author_id),
           case c.kind
             when 'brand_edit' then 'Changed ' || (select string_agg(replace(k, '_', ' '), ', ') from jsonb_object_keys(c.new_value) k)
             when 'verify' then 'Confirmed current' || coalesce(': ' || (c.payload ->> 'note'), '')
             when 'new_contact' then 'Added ' || btrim(coalesce(c.payload ->> 'first_name', '') || ' ' || coalesce(c.payload ->> 'last_name', ''))
                                   || coalesce(', ' || (c.payload ->> 'title'), '')
             when 'contact_update' then 'Updated ' || coalesce((select btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, ''))
                                                                  from contacts ct where ct.id = (c.payload ->> 'contact_id')::uuid), 'a contact')
             when 'contact_left' then coalesce((select btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, ''))
                                                  from contacts ct where ct.id = (c.payload ->> 'contact_id')::uuid), 'A contact') || ' is no longer there'
             when 'new_brand' then 'New brand' || coalesce(' — ' || (select rc.label from retail_categories rc where rc.code = c.payload ->> 'category'), '')
             when 'new_requirement' then 'New requirement — ' || concat_ws(' · ',
                 nullif(concat_ws(' ', c.payload ->> 'deal_type', c.payload ->> 'property_type'), ''),
                 rtd__sf_range((c.payload ->> 'size_min')::numeric, (c.payload ->> 'size_max')::numeric),
                 c.payload ->> 'target_location')
             when 'requirement_update' then 'Updated ' || coalesce((select r.display_code from requirements r where r.id = (c.payload ->> 'requirement_id')::uuid), 'a requirement')
                 || ': ' || (select string_agg(replace(replace(k, 'rtd_', ''), '_', ' '), ', ') from jsonb_object_keys(c.new_value) k)
           end,
           c.status, nullif(c.payload ->> 'requirement_id', '')::uuid
      from rtd_changes c left join entities e on e.id = c.entity_id
     where c.created_at >= since and c.status <> 'rejected'
    union all
    select cl.claimed_at, 'claim', cl.entity_id, e.name, rtd__who(cl.claimed_by), 'Claimed as a client', 'accepted', null::uuid
      from rtd_claims cl join entities e on e.id = cl.entity_id
     where cl.claimed_at >= since
    union all
    select cl.released_at, 'release', cl.entity_id, e.name, rtd__who(cl.released_by), 'Released the claim', 'accepted', null::uuid
      from rtd_claims cl join entities e on e.id = cl.entity_id
     where cl.released_at >= since
    union all
    -- CRM requirements Dan shared to the RTD (RTD-entered ones show through rtd_changes above).
    select r.rtd_shared_at, 'requirement', pty.entity_id, pty.name,
           (select ru.display_name from rtd_users ru where ru.is_admin order by ru.created_at limit 1),
           'Shared requirement ' || coalesce(r.display_code, '') || ' — ' || concat_ws(' · ',
             nullif(concat_ws(' ', r.deal_type, r.property_type), ''),
             rtd__sf_range(r.size_min, r.size_max),
             r.target_location),
           r.status, r.id
      from requirements r cross join lateral rtd__req_party(r.id) pty
     where r.rtd_shared and r.rtd_shared_at >= since and coalesce(r.source_system, '') <> 'rtd'
    union all
    -- Verified in the CRM itself (the connector or a CRM screen), not through the RTD.
    select (rb.last_verified_on::timestamp + time '12:00') at time zone 'America/Chicago', 'verified', rb.entity_id, e.name,
           null::text, 'Confirmed current in the CRM', 'accepted', null::uuid
      from retail_brands rb join entities e on e.id = rb.entity_id
     where rb.last_verified_on >= (since at time zone 'America/Chicago')::date
       and not rb.needs_verification
       and coalesce(rb.source_system, '') <> 'rtd'
       and not exists (select 1 from rtd_changes c where c.entity_id = rb.entity_id and c.kind = 'verify'
                         and c.status = 'accepted' and (c.created_at at time zone 'America/Chicago')::date = rb.last_verified_on)
  ) x(at, kind, entity_id, brand, who, detail, status, requirement_id)
  order by x.at desc
  limit 400;
end
$$;

-- ===========================================================================
-- 6. Dan's review queue
-- ===========================================================================
create or replace function rtd__require_admin()
returns rtd_users
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
begin
  if not u.is_admin then
    raise exception 'RTD: only Dan reviews proposals' using errcode = '42501';
  end if;
  return u;
end
$$;
revoke execute on function rtd__require_admin() from public, anon, authenticated;

-- Every pending note and proposal, oldest first, with what the CRM holds now,
-- any conflict, and duplicate candidates for new brands and contacts.
create or replace function rtd_review_queue()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform rtd__require_admin();
  return coalesce((
    select jsonb_agg(item order by (item ->> 'created_at')) from (
      select jsonb_build_object(
               'type', 'note', 'id', n.id, 'kind', 'note', 'entity_id', n.entity_id, 'brand', e.name,
               'brand_code', e.display_code, 'author', rtd__who(n.author_id), 'created_at', n.created_at,
               'body', n.body, 'tags', to_jsonb(n.tags)) as item
        from rtd_notes n join entities e on e.id = n.entity_id
       where n.status = 'pending'
      union all
      select jsonb_build_object(
               'type', 'change', 'id', c.id, 'kind', c.kind, 'entity_id', c.entity_id,
               'brand', coalesce(e.name, c.payload ->> 'name', c.payload ->> 'party_name',
                                 (select pty.name from rtd__req_party((c.payload ->> 'requirement_id')::uuid) pty)),
               'brand_code', e.display_code,
               'requirement_code', (select r.display_code from requirements r where r.id = (c.payload ->> 'requirement_id')::uuid),
               'author', rtd__who(c.author_id), 'created_at', c.created_at,
               'old_value', c.old_value, 'new_value', c.new_value, 'payload', c.payload,
               'current', case when c.kind = 'brand_edit' then rtd__brand_values(c.entity_id)
                               when c.kind = 'contact_update' then rtd__contact_values((c.payload ->> 'contact_id')::uuid)
                               when c.kind = 'requirement_update' then rtd__req_values((c.payload ->> 'requirement_id')::uuid) end,
               'conflicts', case when c.kind = 'brand_edit' then to_jsonb(rtd__conflicts(c.old_value, rtd__brand_values(c.entity_id)))
                                 when c.kind = 'contact_update'
                                   then to_jsonb(rtd__conflicts(c.old_value, rtd__contact_values((c.payload ->> 'contact_id')::uuid)))
                                 when c.kind = 'requirement_update'
                                   then to_jsonb(rtd__conflicts(c.old_value, rtd__req_values((c.payload ->> 'requirement_id')::uuid)))
                                 else '[]'::jsonb end,
               'contact_name', (select btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, ''))
                                  from contacts ct where ct.id = (c.payload ->> 'contact_id')::uuid),
               'matches', case
                 when c.kind = 'new_brand' then (
                   select coalesce(jsonb_agg(m), '[]'::jsonb)
                     from jsonb_array_elements(find_similar_entities(c.payload ->> 'name', 5)) m
                    where (m ->> 'score')::numeric >= 0.6)
                 when c.kind = 'new_contact' then (
                   select coalesce(jsonb_agg(m), '[]'::jsonb)
                     from jsonb_array_elements(find_similar_contacts(c.payload ->> 'first_name', c.payload ->> 'last_name',
                                                                     c.payload ->> 'email', 5)) m
                    where (m ->> 'score')::numeric >= 0.6)
                 when c.kind = 'new_requirement' and c.payload ->> 'entity_id' is null then (
                   select coalesce(jsonb_agg(m), '[]'::jsonb)
                     from jsonb_array_elements(find_similar_entities(c.payload ->> 'party_name', 5)) m
                    where (m ->> 'score')::numeric >= 0.6)
                 else '[]'::jsonb end) as item
        from rtd_changes c left join entities e on e.id = c.entity_id
       where c.status = 'pending'
    ) q), '[]'::jsonb);
end
$$;

-- Decide one item. p_type 'note' | 'change'; p_decision 'accept' | 'reject' | 'leave'.
-- p_force: accept despite a conflict or a likely duplicate ("it's a different one").
-- p_link_contact_id: for a new contact, link this existing person instead of creating one;
-- for a new requirement, link this existing company instead of creating one.
-- Returns {status: accepted | rejected | left | conflict | duplicate | gone, message?, ...}.
create or replace function rtd_review(p_type text, p_id uuid, p_decision text, p_force boolean default false,
                                      p_link_contact_id uuid default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd__require_admin();
  r jsonb;
  n rtd_notes;
begin
  p_decision := lower(btrim(coalesce(p_decision, '')));
  if p_decision in ('', 'leave') then
    return jsonb_build_object('status', 'left');
  end if;
  if p_decision not in ('accept', 'reject') then
    raise exception 'RTD: decision must be Accept, Reject or Leave' using errcode = '22023';
  end if;

  if p_type = 'note' then
    select * into n from rtd_notes where id = p_id for update;
    if not found or n.status <> 'pending' then
      return jsonb_build_object('status', 'gone', 'message', 'That note was already handled.');
    end if;
    if p_decision = 'accept' then
      perform rtd__note_to_crm(p_id);
    end if;
    update rtd_notes set status = p_decision || 'ed', reviewed_at = now(), reviewed_by = u.id where id = p_id;
    return jsonb_build_object('status', p_decision || 'ed');
  end if;

  if p_type <> 'change' then
    raise exception 'RTD: unknown item type %', p_type using errcode = '22023';
  end if;

  if p_decision = 'reject' then
    update rtd_changes set status = 'rejected', reviewed_at = now(), reviewed_by = u.id,
                           review_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_id and status = 'pending';
    if not found then
      return jsonb_build_object('status', 'gone', 'message', 'That item was already handled.');
    end if;
    return jsonb_build_object('status', 'rejected');
  end if;

  r := rtd__apply(p_id, coalesce(p_force, false), p_link_contact_id);
  if r ->> 'status' <> 'applied' then
    return r;
  end if;
  update rtd_changes set status = 'accepted', reviewed_at = now(), reviewed_by = u.id,
                         result_ref = r ->> 'result_ref', review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;
  return r || jsonb_build_object('status', 'accepted');
end
$$;

create or replace function rtd_review_count()
returns int
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
begin
  if not u.is_admin then return 0; end if;
  return (select count(*) from rtd_notes where status = 'pending')
       + (select count(*) from rtd_changes where status = 'pending');
end
$$;

-- ===========================================================================
-- 8. Requirements in the RTD (added 10/20/2026)
--
-- Dan: "I don't want my CRM requirements to automatically get pushed into the
-- RTD." A CRM requirement is visible in the RTD only after Dan presses
-- "Share to RTD" on its CRM page (requirements.rtd_shared). Requirements
-- entered in the RTD — any property type: retail, office, industrial, flex,
-- land, investment … — are shared from the start. Jami and Trey add and
-- update them through the review queue like every other edit; Dan's go
-- straight in. requirements.details stays CRM-only; the RTD has its own
-- rtd_note (seen by all three) and rtd_contact ("who to call").
-- The RTD never sets a re-confirm date. A status change made through it keeps
-- the CRM's re-confirm-task rule (lib/requirementReconfirm.ts) intact.
-- ===========================================================================
alter table requirements add column if not exists rtd_shared    boolean not null default false;
alter table requirements add column if not exists rtd_shared_at timestamptz;
alter table requirements add column if not exists rtd_note      text;
alter table requirements add column if not exists rtd_contact   text;
create index if not exists idx_requirements_rtd_shared on requirements (status) where rtd_shared;

-- The requirement fields the RTD may set, cleaned and checked ('' clears).
create or replace function rtd__clean_req_fields(p jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  k text;
  v jsonb;
  t text;
  arr text[];
  out jsonb := '{}'::jsonb;
  lim int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return out; end if;
  for k, v in select * from jsonb_each(p) loop
    if not k = any (array['deal_type', 'property_type', 'size_min', 'size_max', 'budget_min', 'budget_max',
                          'target_location', 'timeline', 'status', 'confidence', 'source_date',
                          'target_markets', 'rtd_note', 'rtd_contact']) then
      raise exception 'RTD: % can''t be set here', k using errcode = '22023';
    end if;
    if k = 'target_markets' then
      if v is null or jsonb_typeof(v) = 'null' then
        arr := '{}';
      elsif jsonb_typeof(v) = 'array' then
        select coalesce(array_agg(distinct btrim(x)) filter (where btrim(x) <> ''), '{}') into arr
          from jsonb_array_elements_text(v) x;
      else
        raise exception 'RTD: target markets must be a list' using errcode = '22023';
      end if;
      if not arr <@ array['omaha_metro', 'lincoln', 'greater_nebraska', 'cb_western_iowa'] then
        raise exception 'RTD: unknown market' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v from unnest(arr) x;
      out := out || jsonb_build_object(k, v);
      continue;
    end if;

    t := case when v is null or jsonb_typeof(v) = 'null' then null
              else nullif(btrim(replace(v #>> '{}', E'\r\n', E'\n')), '') end;

    if k in ('size_min', 'size_max', 'budget_min', 'budget_max') then
      if t is not null then
        t := replace(replace(replace(t, ',', ''), ' ', ''), '$', '');
        if t !~ '^[0-9]+(\.[0-9]+)?$' then
          raise exception 'RTD: % must be a number', replace(k, '_', ' ') using errcode = '22023';
        end if;
        out := out || jsonb_build_object(k, t::numeric);
      else
        out := out || jsonb_build_object(k, null);
      end if;
      continue;
    end if;

    if k = 'status' then
      t := coalesce(t, 'active');
      if t not in ('active', 'on_hold', 'fulfilled', 'dead') then
        raise exception 'RTD: status must be active, on hold, fulfilled or dead' using errcode = '22023';
      end if;
    elsif k = 'confidence' and t is not null and t not in ('high', 'medium', 'low') then
      raise exception 'RTD: confidence must be high, medium or low' using errcode = '22023';
    elsif k = 'source_date' and t is not null then
      if t !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'RTD: "heard on" must be a date' using errcode = '22023';
      end if;
      begin
        perform t::date;
      exception when others then
        raise exception 'RTD: "heard on" must be a date' using errcode = '22023';
      end;
      if t::date > (now() at time zone 'America/Chicago')::date + 1 then
        raise exception 'RTD: "heard on" can''t be in the future' using errcode = '22023';
      end if;
    end if;
    lim := case k when 'rtd_note' then 2000 when 'target_location' then 200 when 'rtd_contact' then 300 else 100 end;
    if length(coalesce(t, '')) > lim then
      raise exception 'RTD: % is too long', replace(replace(k, 'rtd_', ''), '_', ' ') using errcode = '22023';
    end if;
    out := out || jsonb_build_object(k, t);
  end loop;
  return out;
end
$$;

create or replace function rtd__req_values(p_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'deal_type', r.deal_type, 'property_type', r.property_type,
    'size_min', r.size_min, 'size_max', r.size_max, 'budget_min', r.budget_min, 'budget_max', r.budget_max,
    'target_location', r.target_location, 'timeline', r.timeline, 'status', r.status,
    'confidence', r.confidence, 'source_date', r.source_date,
    'target_markets', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from unnest(r.target_markets) x),
    'rtd_note', r.rtd_note, 'rtd_contact', r.rtd_contact)
  from requirements r where r.id = p_id;
$$;

-- Who a requirement is for: a directory brand first, then any linked company,
-- then a linked person; else its own code.
create or replace function rtd__req_party(p_id uuid)
returns table (name text, entity_id uuid, is_brand boolean)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  return query
    select coalesce(e.trade_name, e.name), e.id, exists (select 1 from retail_brands rb where rb.entity_id = e.id)
      from requirement_parties rp join entities e on e.id = rp.entity_id
     where rp.requirement_id = p_id
     order by 3 desc, rp.created_at
     limit 1;
  if found then return; end if;
  return query
    select coalesce(nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), 'Unnamed contact'),
           c.entity_id, false
      from requirement_parties rp join contacts c on c.id = rp.contact_id
     where rp.requirement_id = p_id
     order by rp.created_at
     limit 1;
  if found then return; end if;
  return query select r.display_code, null::uuid, false from requirements r where r.id = p_id;
end
$$;

-- Keep the CRM's rule after the RTD changes a status: an active requirement
-- with a re-confirm date has exactly one open re-confirm task; otherwise none.
-- Mirrors syncReconfirmTask in lib/requirementReconfirm.ts.
create or replace function rtd__sync_reconfirm(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r requirements;
  pty record;
  lbl text;
  facts text;
begin
  select * into r from requirements where id = p_id;
  if not found then return; end if;
  if not (r.status = 'active' and r.reconfirm_date is not null) then
    update tasks set status = 'cancelled', updated_at = now()
     where requirement_id = p_id and category = 'reconfirm' and status = 'open';
    return;
  end if;
  if exists (select 1 from tasks where requirement_id = p_id and category = 'reconfirm' and status = 'open') then
    return;
  end if;
  select * into pty from rtd__req_party(p_id);
  lbl := case when pty.entity_id is not null then pty.name
              else coalesce(r.display_code, 'requirement')
                   || coalesce(' (' || nullif(concat_ws(', ', r.deal_type, r.property_type), '') || ')', '') end;
  facts := nullif(concat_ws(', ', 'confidence ' || r.confidence, 'heard ' || r.source_date::text), '');
  insert into tasks (display_code, title, description, due_date, status, category, requirement_id, entity_id)
  values (next_display_code('tasks', 'TASK'), 'Re-confirm: ' || lbl,
          'Re-confirm ' || coalesce(r.display_code, 'requirement') || ' with ' || lbl
            || ': is it still active, and have the size, markets or timing changed?'
            || coalesce(' (' || facts || ')', '')
            || ' Update the requirement''s reconfirm date (or status) when done.',
          r.reconfirm_date, 'open', 'reconfirm', p_id, pty.entity_id);
end
$$;

-- Apply an accepted requirement proposal (called from rtd__apply).
create or replace function rtd__apply_requirement(c rtd_changes, p_force boolean, p_link_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  who text := (select display_name from rtd_users where id = c.author_id);
  f jsonb := c.payload;
  v_entity uuid;
  v_req uuid;
  v_code text;
  matches jsonb;
  cur jsonb;
  conf text[];
begin
  if c.kind = 'new_requirement' then
    v_entity := nullif(f ->> 'entity_id', '')::uuid;
    if v_entity is not null and not exists (select 1 from entities where id = v_entity) then
      return jsonb_build_object('status', 'gone', 'message', 'That company is no longer in the CRM.');
    end if;
    if v_entity is null and p_link_id is not null then
      if not exists (select 1 from entities where id = p_link_id) then
        return jsonb_build_object('status', 'gone', 'message', 'That existing company no longer exists.');
      end if;
      v_entity := p_link_id;
    end if;
    if v_entity is null and nullif(btrim(coalesce(f ->> 'party_name', '')), '') is not null then
      if not p_force then
        select coalesce(jsonb_agg(m), '[]'::jsonb) into matches
          from jsonb_array_elements(find_similar_entities(f ->> 'party_name', 5)) m
         where (m ->> 'score')::numeric >= 0.8;
        if jsonb_array_length(matches) > 0 then
          return jsonb_build_object('status', 'duplicate', 'matches', matches,
            'message', 'This looks like a company already in the CRM.');
        end if;
      end if;
      insert into entities (display_code, name, entity_type, source_system, source_record_id)
      values (next_display_code('entities', 'ENT'), btrim(f ->> 'party_name'), 'Other', 'rtd', c.id::text)
      returning id into v_entity;
    end if;

    v_code := next_display_code('requirements', 'REQ');
    insert into requirements (display_code, deal_type, property_type, size_min, size_max, budget_min, budget_max,
                              target_location, timeline, status, priority, source, confidence, source_date,
                              target_markets, rtd_shared, rtd_shared_at, rtd_note, rtd_contact,
                              source_system, source_record_id)
    values (v_code, f ->> 'deal_type', f ->> 'property_type', (f ->> 'size_min')::numeric, (f ->> 'size_max')::numeric,
            (f ->> 'budget_min')::numeric, (f ->> 'budget_max')::numeric, f ->> 'target_location', f ->> 'timeline',
            coalesce(f ->> 'status', 'active'), 'medium', 'RTD — ' || who, f ->> 'confidence',
            coalesce((f ->> 'source_date')::date, (c.created_at at time zone 'America/Chicago')::date),
            coalesce(array(select jsonb_array_elements_text(f -> 'target_markets')), '{}'),
            true, now(), f ->> 'rtd_note', f ->> 'rtd_contact', 'rtd', c.id::text)
    returning id into v_req;
    if v_entity is not null then
      insert into requirement_parties (requirement_id, entity_id) values (v_req, v_entity);
    end if;
    update rtd_changes set payload = payload || jsonb_build_object('requirement_id', v_req),
                           entity_id = coalesce(entity_id, v_entity)
     where id = c.id;
    return jsonb_build_object('status', 'applied', 'result_ref', v_code, 'requirement_id', v_req);
  end if;

  -- requirement_update
  v_req := (f ->> 'requirement_id')::uuid;
  if not exists (select 1 from requirements where id = v_req and rtd_shared) then
    return jsonb_build_object('status', 'gone', 'message', 'That requirement is no longer shared to the RTD.');
  end if;
  cur := rtd__req_values(v_req);
  conf := rtd__conflicts(c.old_value, cur);
  if conf <> '{}' and not p_force then
    return jsonb_build_object('status', 'conflict', 'fields', to_jsonb(conf), 'current', cur,
      'message', 'The CRM changed since this was proposed: ' || array_to_string(array(select replace(x, '_', ' ') from unnest(conf) x), ', '));
  end if;
  f := c.new_value;
  update requirements r set
    deal_type       = case when f ? 'deal_type'       then f ->> 'deal_type'               else r.deal_type end,
    property_type   = case when f ? 'property_type'   then f ->> 'property_type'           else r.property_type end,
    size_min        = case when f ? 'size_min'        then (f ->> 'size_min')::numeric     else r.size_min end,
    size_max        = case when f ? 'size_max'        then (f ->> 'size_max')::numeric     else r.size_max end,
    budget_min      = case when f ? 'budget_min'      then (f ->> 'budget_min')::numeric   else r.budget_min end,
    budget_max      = case when f ? 'budget_max'      then (f ->> 'budget_max')::numeric   else r.budget_max end,
    target_location = case when f ? 'target_location' then f ->> 'target_location'         else r.target_location end,
    timeline        = case when f ? 'timeline'        then f ->> 'timeline'                else r.timeline end,
    status          = case when f ? 'status'          then f ->> 'status'                  else r.status end,
    confidence      = case when f ? 'confidence'      then f ->> 'confidence'              else r.confidence end,
    source_date     = case when f ? 'source_date'     then (f ->> 'source_date')::date     else r.source_date end,
    target_markets  = case when f ? 'target_markets'
                           then array(select jsonb_array_elements_text(f -> 'target_markets')) else r.target_markets end,
    rtd_note        = case when f ? 'rtd_note'        then f ->> 'rtd_note'                else r.rtd_note end,
    rtd_contact     = case when f ? 'rtd_contact'     then f ->> 'rtd_contact'             else r.rtd_contact end,
    updated_at      = now()
   where r.id = v_req;
  if f ? 'status' then
    perform rtd__sync_reconfirm(v_req);
  end if;
  select display_code into v_code from requirements where id = v_req;
  return jsonb_build_object('status', 'applied', 'result_ref', v_code, 'requirement_id', v_req);
end
$$;

revoke execute on function rtd__clean_req_fields(jsonb)                       from public, anon, authenticated;
revoke execute on function rtd__req_values(uuid)                              from public, anon, authenticated;
revoke execute on function rtd__req_party(uuid)                               from public, anon, authenticated;
revoke execute on function rtd__sync_reconfirm(uuid)                          from public, anon, authenticated;
revoke execute on function rtd__apply_requirement(rtd_changes, boolean, uuid) from public, anon, authenticated;

-- p_req: {entity_id (a directory brand) | party_name (any company), property_type, deal_type,
--         size_min, size_max, budget_min, budget_max, target_location, timeline, confidence,
--         source_date, target_markets, rtd_note, rtd_contact}
create or replace function rtd_add_requirement(p_req jsonb, p_force boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_entity uuid;
  v_party text := nullif(btrim(coalesce(p_req ->> 'party_name', '')), '');
  f jsonb;
begin
  perform rtd_current_user();
  if nullif(p_req ->> 'entity_id', '') is not null then
    v_entity := (p_req ->> 'entity_id')::uuid;
    if not exists (select 1 from retail_brands where entity_id = v_entity) then
      raise exception 'RTD: that brand isn''t in the directory' using errcode = '22023';
    end if;
    v_party := null;
  elsif v_party is null then
    raise exception 'RTD: say who the requirement is for' using errcode = '22023';
  elsif length(v_party) > 200 then
    raise exception 'RTD: that company name is too long' using errcode = '22023';
  end if;
  f := rtd__clean_req_fields(p_req - 'entity_id' - 'party_name');
  if f ->> 'property_type' is null then
    raise exception 'RTD: pick a property type' using errcode = '22023';
  end if;
  if (f ->> 'size_min')::numeric > (f ->> 'size_max')::numeric then
    raise exception 'RTD: the minimum size is larger than the maximum' using errcode = '22023';
  end if;
  if (f ->> 'budget_min')::numeric > (f ->> 'budget_max')::numeric then
    raise exception 'RTD: the minimum budget is larger than the maximum' using errcode = '22023';
  end if;
  f := f || jsonb_build_object('entity_id', v_entity, 'party_name', coalesce(v_party, (select name from entities where id = v_entity)));
  return rtd__submit('new_requirement', v_entity, null, null, f, p_force);
end
$$;

create or replace function rtd_update_requirement(p_id uuid, p_fields jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  cur jsonb;
  f jsonb;
  newv jsonb := '{}'::jsonb;
  oldv jsonb := '{}'::jsonb;
  k text;
  merged jsonb;
begin
  perform rtd_current_user();
  if not exists (select 1 from requirements where id = p_id and rtd_shared) then
    raise exception 'RTD: that requirement isn''t shared to the RTD' using errcode = '22023';
  end if;
  cur := rtd__req_values(p_id);
  f := rtd__clean_req_fields(p_fields);
  for k in select jsonb_object_keys(f) loop
    if not rtd__same(f -> k, cur -> k) then
      newv := newv || jsonb_build_object(k, f -> k);
      oldv := oldv || jsonb_build_object(k, cur -> k);
    end if;
  end loop;
  if newv = '{}'::jsonb then
    return jsonb_build_object('status', 'no_change');
  end if;
  merged := cur || newv;
  if (merged ->> 'size_min')::numeric > (merged ->> 'size_max')::numeric then
    raise exception 'RTD: the minimum size is larger than the maximum' using errcode = '22023';
  end if;
  if (merged ->> 'budget_min')::numeric > (merged ->> 'budget_max')::numeric then
    raise exception 'RTD: the minimum budget is larger than the maximum' using errcode = '22023';
  end if;
  return rtd__submit('requirement_update', (select p.entity_id from rtd__req_party(p_id) p), oldv, newv,
                     jsonb_build_object('requirement_id', p_id));
end
$$;

-- The Requirements list: shared requirements only. p_status '' = any status.
-- p_size: the requirement's range contains it (an open end counts as no limit;
-- no size on file still shows). p_market: requirements with no markets set still show.
create or replace function rtd_requirements(
  p_status        text    default 'active',
  p_property_type text    default null,
  p_deal_type     text    default null,
  p_market        text    default null,
  p_size          numeric default null,
  p_q             text    default null,
  p_limit         int     default 200,
  p_offset        int     default 0
)
returns table (
  id uuid, display_code text, party text, entity_id uuid, is_brand boolean,
  deal_type text, property_type text, size_min numeric, size_max numeric,
  budget_min numeric, budget_max numeric, target_location text, target_markets text[],
  timeline text, status text, confidence text, source_date date, reconfirm_date date,
  rtd_note text, rtd_contact text, added_by text, shared_at timestamptz, updated_at timestamptz,
  pending_updates int, total_count bigint
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  perform rtd_current_user();
  if p_limit is null or p_limit < 1 then p_limit := 200; end if;
  if p_limit > 5000 then p_limit := 5000; end if;
  return query
  with base as (
    select r.*, pty.name as pname, pty.entity_id as peid, pty.is_brand as pbrand
      from requirements r
      cross join lateral rtd__req_party(r.id) pty
     where r.rtd_shared
       and (coalesce(p_status, '') = '' or r.status = p_status)
       and (nullif(p_property_type, '') is null or lower(r.property_type) = lower(p_property_type))
       and (nullif(p_deal_type, '') is null or lower(r.deal_type) = lower(p_deal_type))
       and (nullif(p_market, '') is null or r.target_markets = '{}' or p_market = any (r.target_markets))
       and (p_size is null or ((r.size_min is null or r.size_min <= p_size) and (r.size_max is null or r.size_max >= p_size)))
  )
  select b.id, b.display_code, b.pname, b.peid, b.pbrand,
         b.deal_type, b.property_type, b.size_min, b.size_max, b.budget_min, b.budget_max,
         b.target_location, b.target_markets, b.timeline, b.status, b.confidence, b.source_date, b.reconfirm_date,
         b.rtd_note, b.rtd_contact,
         (select rtd__who(c.author_id) from rtd_changes c
           where c.kind = 'new_requirement' and c.status = 'accepted' and c.payload ->> 'requirement_id' = b.id::text
           limit 1),
         b.rtd_shared_at, b.updated_at,
         (select count(*) from rtd_changes c
           where c.kind = 'requirement_update' and c.status = 'pending' and c.payload ->> 'requirement_id' = b.id::text)::int,
         count(*) over ()
    from base b
   where v_q is null or b.pname ilike '%' || v_q || '%' or b.target_location ilike '%' || v_q || '%'
      or b.display_code ilike v_q || '%'
   order by b.status = 'active' desc, coalesce(b.source_date, b.created_at::date) desc, b.display_code desc
   limit p_limit offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- One shared requirement with its pending updates and history; null when not shared.
create or replace function rtd_requirement(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
  v jsonb;
begin
  if not exists (select 1 from requirements where id = p_id and rtd_shared) then
    return null;
  end if;
  select rtd__req_values(r.id) || jsonb_build_object(
           'id', r.id, 'display_code', r.display_code, 'reconfirm_date', r.reconfirm_date,
           'shared_at', r.rtd_shared_at, 'created_at', r.created_at, 'updated_at', r.updated_at,
           'party', pty.name, 'entity_id', pty.entity_id, 'is_brand', pty.is_brand,
           'me', jsonb_build_object('is_admin', u.is_admin),
           'added_by', (select rtd__who(c.author_id) from rtd_changes c
                         where c.kind = 'new_requirement' and c.status = 'accepted'
                           and c.payload ->> 'requirement_id' = r.id::text limit 1),
           'pending', coalesce((
             select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'author', rtd__who(c.author_id),
                                                 'created_at', c.created_at, 'old_value', c.old_value,
                                                 'new_value', c.new_value, 'payload', c.payload) order by c.created_at desc)
               from rtd_changes c
              where c.kind = 'requirement_update' and c.status = 'pending' and c.payload ->> 'requirement_id' = r.id::text), '[]'::jsonb),
           'history', coalesce((
             select jsonb_agg(jsonb_build_object('at', c.created_at, 'kind', c.kind, 'status', c.status,
                                                 'author', rtd__who(c.author_id), 'reviewed_by', rtd__who(c.reviewed_by),
                                                 'old_value', c.old_value, 'new_value', c.new_value, 'payload', c.payload,
                                                 'result_ref', c.result_ref) order by c.created_at desc)
               from rtd_changes c
              where c.kind in ('new_requirement', 'requirement_update') and c.status <> 'pending'
                and c.payload ->> 'requirement_id' = r.id::text), '[]'::jsonb))
    into v
    from requirements r cross join lateral rtd__req_party(r.id) pty
   where r.id = p_id;
  return v;
end
$$;

-- New requirements waiting for Dan, visible to all three.
create or replace function rtd_requirement_proposals()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform rtd_current_user();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'author', rtd__who(c.author_id),
                                        'created_at', c.created_at, 'payload', c.payload,
                                        'entity_id', c.entity_id, 'old_value', null, 'new_value', null)
                     order by c.created_at desc)
      from rtd_changes c where c.kind = 'new_requirement' and c.status = 'pending'), '[]'::jsonb);
end
$$;

-- Property and deal types already in use among shared requirements, for the filters.
create or replace function rtd_requirement_types()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform rtd_current_user();
  return jsonb_build_object(
    'property_types', coalesce((select jsonb_agg(distinct property_type order by property_type)
                                  from requirements where rtd_shared and property_type is not null), '[]'::jsonb),
    'deal_types', coalesce((select jsonb_agg(distinct deal_type order by deal_type)
                              from requirements where rtd_shared and deal_type is not null), '[]'::jsonb));
end
$$;

-- rtd_brand from 028, redefined 10/20/2026: a brand page lists only requirements
-- Dan shared to the RTD (requirements.rtd_shared), with their ids for the
-- requirement page. Structured fields only — never requirements.details.
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
               'id', r.id, 'display_code', r.display_code, 'deal_type', r.deal_type, 'property_type', r.property_type,
               'size_min', r.size_min, 'size_max', r.size_max, 'target_markets', to_jsonb(r.target_markets),
               'timeline', r.timeline, 'status', r.status, 'confidence', r.confidence,
               'source_date', r.source_date, 'reconfirm_date', r.reconfirm_date)
             order by (r.status = 'active') desc, r.reconfirm_date nulls last)
        from requirement_parties rp join requirements r on r.id = rp.requirement_id
       where rp.entity_id = e.id and r.rtd_shared), '[]'::jsonb)
  )
  into v
  from retail_brands rb
  join entities e on e.id = rb.entity_id
  left join retail_categories rc on rc.code = rb.category
  where e.id = p_entity_id;

  return v;   -- null when the entity has no brand profile
end
$$;


-- ===========================================================================
-- 7. Grants: the browser may call the rtd_* entry points, nothing else
-- ===========================================================================
revoke execute on function rtd_claims_for(uuid[])                      from public, anon;
revoke execute on function rtd_claim(uuid)                             from public, anon;
revoke execute on function rtd_release(uuid)                           from public, anon;
revoke execute on function rtd_add_note(uuid, text, text[])            from public, anon;
revoke execute on function rtd_propose_edit(uuid, jsonb)               from public, anon;
revoke execute on function rtd_mark_verified(uuid, text)               from public, anon;
revoke execute on function rtd_add_contact(uuid, jsonb, boolean)       from public, anon;
revoke execute on function rtd_update_contact(uuid, uuid, jsonb)       from public, anon;
revoke execute on function rtd_contact_left(uuid, uuid, text)          from public, anon;
revoke execute on function rtd_brand_lookalikes(text)                  from public, anon;
revoke execute on function rtd_add_brand(jsonb, boolean)               from public, anon;
revoke execute on function rtd_brand_activity(uuid)                    from public, anon;
revoke execute on function rtd_whats_new(int)                          from public, anon;
revoke execute on function rtd_review_queue()                          from public, anon;
revoke execute on function rtd_review(text, uuid, text, boolean, uuid, text) from public, anon;
revoke execute on function rtd_review_count()                          from public, anon;

grant execute on function rtd_claims_for(uuid[])                      to authenticated;
grant execute on function rtd_claim(uuid)                             to authenticated;
grant execute on function rtd_release(uuid)                           to authenticated;
grant execute on function rtd_add_note(uuid, text, text[])            to authenticated;
grant execute on function rtd_propose_edit(uuid, jsonb)               to authenticated;
grant execute on function rtd_mark_verified(uuid, text)               to authenticated;
grant execute on function rtd_add_contact(uuid, jsonb, boolean)       to authenticated;
grant execute on function rtd_update_contact(uuid, uuid, jsonb)       to authenticated;
grant execute on function rtd_contact_left(uuid, uuid, text)          to authenticated;
grant execute on function rtd_brand_lookalikes(text)                  to authenticated;
grant execute on function rtd_add_brand(jsonb, boolean)               to authenticated;
grant execute on function rtd_brand_activity(uuid)                    to authenticated;
grant execute on function rtd_whats_new(int)                          to authenticated;
grant execute on function rtd_review_queue()                          to authenticated;
grant execute on function rtd_review(text, uuid, text, boolean, uuid, text) to authenticated;
grant execute on function rtd_review_count()                          to authenticated;

revoke execute on function rtd_add_requirement(jsonb, boolean)                                   from public, anon;
revoke execute on function rtd_update_requirement(uuid, jsonb)                                   from public, anon;
revoke execute on function rtd_requirements(text, text, text, text, numeric, text, int, int)     from public, anon;
revoke execute on function rtd_requirement(uuid)                                                 from public, anon;
revoke execute on function rtd_requirement_proposals()                                           from public, anon;
revoke execute on function rtd_requirement_types()                                               from public, anon;
grant execute on function rtd_add_requirement(jsonb, boolean)                                    to authenticated;
grant execute on function rtd_update_requirement(uuid, jsonb)                                    to authenticated;
grant execute on function rtd_requirements(text, text, text, text, numeric, text, int, int)      to authenticated;
grant execute on function rtd_requirement(uuid)                                                  to authenticated;
grant execute on function rtd_requirement_proposals()                                            to authenticated;
grant execute on function rtd_requirement_types()                                                to authenticated;
-- rtd_brand was replaced above; keep 028's grant explicit.
revoke execute on function rtd_brand(uuid) from public, anon;
grant execute on function rtd_brand(uuid) to authenticated;

commit;
