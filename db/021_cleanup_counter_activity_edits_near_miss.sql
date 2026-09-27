-- 021 — the small cleanup build (9/27/2026)
--
-- Three fixes queued since the 9/24/2026 fifth pass, shipped together ahead of
-- the deadlines build and the RealNex import, both of which lean on them.
--
-- 1. display_code_counters + next_display_code(table, prefix)
--    Display codes were max + 1, so merging or deleting the NEWEST row let the
--    next insert reissue its number (observed 9/24/2026: PROP-0061 was merged
--    away, and four seconds later a different property was issued PROP-0061).
--    A counter per prefix only ever increments, so a retired code stays
--    retired. It also takes a row lock, so two simultaneous inserts can no
--    longer read the same max, and it compares numbers rather than text, so
--    CON-10000 will sort correctly when it comes.
--
-- 2. activity_log edits — edited_at, activity_log_edits, update_activity()
--    The activity log was the only core table with no update path. Linking
--    mistakes (LOG-0159 saved without Tom Mausbach's contact) could only be
--    left in place or papered over with a second entry. update_activity()
--    changes only the fields supplied and writes one history row per field
--    that actually changed — old value, new value, when, and from where — so
--    the log stays usable as evidence in a procuring-cause or first-
--    introduction question. Dan's call 9/27/2026: history table, not an
--    original_summary column.
--
--    No next_step_completed_at. That column was specced 9/22/2026, before
--    migration 018 made every dated next step a task. Completing the task is
--    now what clears it from the Dashboard; a second "done" flag on the
--    activity would be a second source of truth for the same fact.
--
-- 3. find_similar_entities — a report-only "same leading word" signal
--    "Kaizen Submission Grappling LLC" vs "Kaizen Submission Group" scores
--    0.63; "Kaizen Grappling" vs the same row scores 0.28 and was not reported
--    at all. Names sharing their first distinctive word (generic words such as
--    group, holdings, properties, omaha skipped) now score at least 0.6 —
--    enough to be LISTED on create, never enough to BLOCK (0.8), because
--    blocking would stop every legitimate Kaizen, Sola or Hy-Vee franchisee.
--
-- Apply in the Supabase SQL editor, then run the VERIFICATION query at the
-- bottom, then `notify pgrst, 'reload schema';`. Per the 9/24/2026 rule, this
-- migration is "applied" only when the verification query returns the
-- expected row.

begin;

-- ---------------------------------------------------------------------------
-- 1. Display-code counter
-- ---------------------------------------------------------------------------
create table if not exists display_code_counters (
  prefix     text primary key,
  last_value integer not null check (last_value >= 0),
  updated_at timestamptz not null default now()
);
alter table display_code_counters enable row level security;

-- Highest number currently used under a prefix in a table. Numeric, not
-- lexical, so it is right past four digits.
create or replace function max_display_code_number(p_table text, p_prefix text)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_max integer;
begin
  if p_prefix !~ '^[A-Z]{2,10}$' then
    raise exception 'Invalid display-code prefix: %', p_prefix;
  end if;
  execute format(
    'select coalesce(max((substring(display_code from %L))::integer), 0) from %I',
    '^' || p_prefix || '-(\d+)$',
    p_table
  ) into v_max;
  return v_max;
end;
$$;

-- The one function every create path calls. On first use of a prefix the
-- counter is seeded from the table's current highest number; after that it
-- only ever goes up. The seed insert is ON CONFLICT DO NOTHING and the
-- increment is a single UPDATE ... RETURNING, so concurrent callers queue on
-- the row lock instead of reading the same value.
create or replace function next_display_code(p_table text, p_prefix text)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into display_code_counters (prefix, last_value)
  values (p_prefix, max_display_code_number(p_table, p_prefix))
  on conflict (prefix) do nothing;

  -- Never behind the table: if a row was ever inserted with a code the
  -- counter didn't issue (a hand-run SQL load), jump past it.
  update display_code_counters
     set last_value = greatest(last_value, max_display_code_number(p_table, p_prefix)) + 1,
         updated_at = now()
   where prefix = p_prefix
  returning last_value into v_next;

  return p_prefix || '-' || lpad(v_next::text, 4, '0');
end;
$$;

-- Seed every prefix in use today, so the verification query can see them and
-- the first call after deploy does not pay the seeding cost.
insert into display_code_counters (prefix, last_value)
select v.prefix, max_display_code_number(v.tbl, v.prefix)
  from (values
    ('contacts', 'CON'), ('entities', 'ENT'), ('properties', 'PROP'),
    ('activity_log', 'LOG'), ('tasks', 'TASK'), ('requirements', 'REQ'),
    ('spaces', 'SPACE'), ('leases', 'LEASE'), ('lease_events', 'EVENT'),
    ('property_expenses', 'EXP'), ('owner_signals', 'SIG')
  ) as v(tbl, prefix)
on conflict (prefix) do nothing;

-- Codes known to have been issued and then merged away as the highest
-- number, so max + 1 would have reissued them. PROP-0061 was already
-- reissued on 9/24/2026 (and is in use again), so nothing to reserve today;
-- the counter is what stops it happening again.

-- ---------------------------------------------------------------------------
-- 2. Activity edits
-- ---------------------------------------------------------------------------
alter table activity_log add column if not exists edited_at timestamptz;

create table if not exists activity_log_edits (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activity_log(id) on delete cascade,
  field       text not null,
  old_value   text,
  new_value   text,
  edited_at   timestamptz not null default now(),
  source      text            -- 'agent_api' / 'web'
);
create index if not exists idx_activity_log_edits_activity
  on activity_log_edits (activity_id, edited_at desc);
alter table activity_log_edits enable row level security;

-- Only the keys present in p_patch change. An empty string clears a field;
-- activity_type and activity_date cannot be cleared. Returns the updated row
-- plus the list of fields that actually changed. Everything happens in one
-- transaction, so an edit never lands without its history.
create or replace function update_activity(
  p_id     uuid,
  p_patch  jsonb,
  p_source text default 'agent_api'
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_old     activity_log;
  v_new     activity_log;
  v_key     text;
  v_changed text[] := '{}';
  v_allowed text[] := array[
    'activity_type', 'activity_date', 'performed_by', 'summary',
    'next_step', 'next_step_due_date', 'client_visible',
    'contact_id', 'entity_id', 'project_id', 'property_id'
  ];
begin
  select * into v_old from activity_log where id = p_id for update;
  if not found then
    raise exception 'Activity not found.' using errcode = 'P0002';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if not v_key = any(v_allowed) then
      raise exception 'Field % cannot be edited on an activity.', v_key using errcode = '22023';
    end if;
  end loop;

  if p_patch ? 'activity_type' and nullif(btrim(p_patch->>'activity_type'), '') is null then
    raise exception 'activity_type cannot be empty.' using errcode = '22023';
  end if;
  if p_patch ? 'activity_date' and nullif(btrim(p_patch->>'activity_date'), '') is null then
    raise exception 'activity_date cannot be empty.' using errcode = '22023';
  end if;

  update activity_log set
    activity_type      = case when p_patch ? 'activity_type'      then btrim(p_patch->>'activity_type') else activity_type end,
    activity_date      = case when p_patch ? 'activity_date'      then (p_patch->>'activity_date')::timestamptz else activity_date end,
    performed_by       = case when p_patch ? 'performed_by'       then nullif(btrim(p_patch->>'performed_by'), '') else performed_by end,
    summary            = case when p_patch ? 'summary'            then nullif(btrim(p_patch->>'summary'), '') else summary end,
    next_step          = case when p_patch ? 'next_step'          then nullif(btrim(p_patch->>'next_step'), '') else next_step end,
    next_step_due_date = case when p_patch ? 'next_step_due_date' then nullif(btrim(p_patch->>'next_step_due_date'), '')::date else next_step_due_date end,
    client_visible     = case when p_patch ? 'client_visible'     then coalesce((p_patch->>'client_visible')::boolean, false) else client_visible end,
    contact_id         = case when p_patch ? 'contact_id'         then nullif(btrim(p_patch->>'contact_id'), '')::uuid else contact_id end,
    entity_id          = case when p_patch ? 'entity_id'          then nullif(btrim(p_patch->>'entity_id'), '')::uuid else entity_id end,
    project_id         = case when p_patch ? 'project_id'         then nullif(btrim(p_patch->>'project_id'), '')::uuid else project_id end,
    property_id        = case when p_patch ? 'property_id'        then nullif(btrim(p_patch->>'property_id'), '')::uuid else property_id end
  where id = p_id
  returning * into v_new;

  foreach v_key in array v_allowed loop
    if (to_jsonb(v_old) -> v_key) is distinct from (to_jsonb(v_new) -> v_key) then
      v_changed := v_changed || v_key;
      insert into activity_log_edits (activity_id, field, old_value, new_value, source)
      values (p_id, v_key, to_jsonb(v_old) ->> v_key, to_jsonb(v_new) ->> v_key, p_source);
    end if;
  end loop;

  if array_length(v_changed, 1) > 0 then
    update activity_log set edited_at = now() where id = p_id returning * into v_new;
  end if;

  return jsonb_build_object('activity', to_jsonb(v_new), 'changed', to_jsonb(v_changed));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Same-leading-word near miss on entities (report only)
-- ---------------------------------------------------------------------------
-- First word of an already-normalized entity name that says something about
-- WHICH company it is: at least four characters, starts with a letter, and
-- not a word that appears in half the names in Omaha.
create or replace function entity_lead_token(p_norm text)
returns text
language sql
immutable
as $$
  select coalesce((
    select w
      from regexp_split_to_table(coalesce(p_norm, ''), ' ') with ordinality as t(w, n)
     where length(w) >= 4
       and w ~ '^[a-z]'
       and w not in (
         'group', 'holding', 'holdings', 'properties', 'property', 'investment',
         'investments', 'partner', 'partners', 'partnership', 'enterprise',
         'enterprises', 'management', 'development', 'developers', 'realty',
         'real', 'estate', 'capital', 'ventures', 'services', 'associates',
         'omaha', 'nebraska', 'lincoln', 'council', 'bluffs', 'iowa', 'papillion',
         'bellevue', 'elkhorn', 'gretna', 'american', 'america', 'national',
         'first', 'united', 'midwest', 'great', 'plains', 'west', 'east', 'north',
         'south', 'central', 'center', 'centre', 'plaza', 'retail', 'commercial',
         'family', 'saint', 'land', 'home', 'homes'
       )
     order by n
     limit 1
  ), '');
$$;

create or replace function find_similar_entities(
  p_name text,
  p_limit integer default 5
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with target as (
    select normalize_entity_name(p_name) as norm,
           entity_lead_token(normalize_entity_name(p_name)) as lead
  ),
  base as (
    select e.id,
           e.display_code,
           e.name,
           e.trade_name,
           e.entity_type,
           case
             when t.norm <> '' and e.name_normalized = t.norm then 1.0
             when t.norm <> '' and exists (
                    select 1 from entity_aliases a
                     where a.entity_id = e.id
                       and normalize_entity_name(a.alias) = t.norm) then 0.95
             when t.norm <> '' and e.name_normalized <> ''
                  and (e.name_normalized like '%' || t.norm || '%'
                       or t.norm like '%' || e.name_normalized || '%') then 0.9
             else similarity(e.name_normalized, t.norm)
           end::numeric as raw_score,
           case
             when t.norm <> '' and e.name_normalized = t.norm
               then 'same name once punctuation and LLC/Inc are removed'
             when t.norm <> '' and exists (
                    select 1 from entity_aliases a
                     where a.entity_id = e.id
                       and normalize_entity_name(a.alias) = t.norm)
               then 'matches a known alias of this entity'
             when t.norm <> '' and e.name_normalized <> ''
                  and (e.name_normalized like '%' || t.norm || '%'
                       or t.norm like '%' || e.name_normalized || '%')
               then 'one name contains the other (TitleCore / TitleCore National)'
             else 'similar name'
           end as raw_reason,
           (t.lead <> '' and entity_lead_token(e.name_normalized) = t.lead) as same_lead,
           t.lead
      from entities e, target t
     where t.norm <> ''
  ),
  scored as (
    select id, display_code, name, trade_name, entity_type,
           case when same_lead and raw_score < 0.6 then 0.6::numeric else raw_score end as score,
           case when same_lead and raw_score < 0.8
                then 'same leading name word ("' || lead || '") — possibly the same company '
                     || 'or a franchisee; reported, never blocked'
                else raw_reason end as reason
      from base
  )
  select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.score desc), '[]'::jsonb)
    from (select * from scored where score >= 0.4 order by score desc limit greatest(p_limit, 1)) s;
$$;

commit;

-- VERIFICATION — run after the block above. Expected: one row,
--   counters = 11 | counter_behind = 0 | has_edited_at = true |
--   has_edits_table = true | has_update_fn = true | kaizen_near_miss = true
select
  (select count(*) from display_code_counters)                                      as counters,
  (select count(*) from display_code_counters c
     join (values ('contacts','CON'),('entities','ENT'),('properties','PROP'),
                  ('activity_log','LOG'),('tasks','TASK'),('requirements','REQ'),
                  ('spaces','SPACE'),('leases','LEASE'),('lease_events','EVENT'),
                  ('property_expenses','EXP'),('owner_signals','SIG')) v(tbl, prefix)
       on v.prefix = c.prefix
    where c.last_value < max_display_code_number(v.tbl, v.prefix))                  as counter_behind,
  exists (select 1 from information_schema.columns
           where table_name = 'activity_log' and column_name = 'edited_at')         as has_edited_at,
  exists (select 1 from information_schema.tables
           where table_name = 'activity_log_edits')                                  as has_edits_table,
  exists (select 1 from pg_proc where proname = 'update_activity')                   as has_update_fn,
  exists (select 1 from jsonb_array_elements(find_similar_entities('Kaizen Grappling')) x
           where x->>'name' ilike 'kaizen%')                                         as kaizen_near_miss;

-- Then: notify pgrst, 'reload schema';
