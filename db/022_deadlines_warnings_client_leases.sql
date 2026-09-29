-- 022 — Deadlines, warnings and client-lease derivation (Build #1, 9/29/2026)
--
-- Why: on 9/26/2026 the Dashboard review found that nothing watched Dan's own
-- agreements. Krenzien's listing lapsed 4/30, its 120-day tail ran out 8/28
-- with a $925K offer live, and it surfaced only because someone read the file.
-- This migration gives every project a list of dated deadlines, derives the
-- dates that follow from other dates, and turns each approaching date into a
-- Your Move task on the day its warning is due.
--
-- Rulings (Dan, 9/26 and 9/29/2026):
--   * The Dashboard shows nothing in the future. A deadline reaches it only as
--     a warning task on the day that warning fires.
--   * Lead times: listing expiration 90/60/30 days; deposits 3 days; client
--     lease options — 13 months before EXPIRATION, plus 90 and 30 days before
--     the option notice deadline. Other types carry defaults set below; they
--     are rows in deadline_warning_rules, so changing one is a data edit.
--   * Derived dates: LA expiration -> tail end (+120 days) and Existing
--     Prospect List due (+15 business days); PA effective date -> deposit due
--     (+ the number of days that PA gives, asked for at entry, no default).
--   * Client leases are derived, never flagged by hand: a current lease whose
--     tenant is the client on an active or closed-won project, or whose
--     landlord or building is on one of Dan's listings.
--   * Warnings fire from a daily Vercel Cron job (~5 a.m. Central). The
--     Dashboard also runs the generator on load as a safety net; it is
--     idempotent, so a double run never duplicates a task.
--
-- One open warning task per deadline. When the next lead time arrives and
-- the earlier warning's task is still open, that task is re-titled and
-- re-dated rather than a second task being stacked on it. If Dan completed
-- the earlier one, a new task is created. Completing the deadline itself
-- closes any open warning task for it.
--
-- Apply in the Supabase SQL editor, then run the VERIFICATION query at the
-- bottom, then `notify pgrst, 'reload schema';`. Applied = the verification
-- query returns the expected row.

begin;

-- ---------------------------------------------------------------------------
-- 1. Client link on projects, backfilled (confirmed by Dan in chat 9/29/2026)
-- ---------------------------------------------------------------------------
alter table projects
  add column if not exists client_entity_id uuid references entities(id) on delete set null;
create index if not exists idx_projects_client_entity on projects(client_entity_id);

update projects p
   set client_entity_id = e.id
  from (values
    ('CL-2305 Krenzien Dr',                              'ENT-0085'),
    ('CS-3167 Joliet Ave',                               'ENT-0065'),
    ('CS-2802 Plum Creek Pky - Shoppes of Lexington',    'ENT-0037'),
    ('CL-4930 L St',                                     'ENT-0012'),
    ('CL-3606 S 61st Ave Cir',                           'ENT-0003'),
    ('L-11010 Blondo St',                                'ENT-0016'),
    ('SL-W2W-5040 N 27th',                               'ENT-0016'),
    ('SL-W2W-12977 W Center Rd',                         'ENT-0016'),
    ('BR-Hy-Vee 108th & Hwy 370',                        'ENT-0016'),
    ('SL-United Healthcare Norfolk NE',                  'ENT-0011'),
    ('LRT-Palm Beach Tan-16819QSt',                      'ENT-0001'),
    ('TR-Team Clase Codigo LLC',                         'ENT-0025'),
    ('TR/BR-Astlali Cocina & Tequila',                   'ENT-0026'),
    ('TR-West Coast Sourdough Deli',                     'ENT-0030'),
    ('TR-JC Hobby',                                      'ENT-0014'),
    ('TR-SalonCentric-Store 4701',                       'ENT-0068'),
    ('TR-SalonCentric-Store 4704',                       'ENT-0068')
  ) as v(project_code, ent_code)
  join entities e on e.display_code = v.ent_code
 where p.project_code = v.project_code
   and p.client_entity_id is null;

-- ---------------------------------------------------------------------------
-- 2. Deadline types — a closed vocabulary (it passes the 9/16/2026 test:
--    the set of contract dates is naturally closed). Adding a type is an
--    explicit insert, so a typo can't create a near-duplicate.
-- ---------------------------------------------------------------------------
create table if not exists deadline_types (
  code          text primary key,
  label         text not null unique,
  family        text not null check (family in ('listing', 'purchase', 'lease', 'other')),
  is_money      boolean not null default false,  -- money due: flagged in the Preview
  -- Derivation: a row of this type is created automatically when a row of
  -- derive_from is dated. derive_days = calendar or business days after the
  -- anchor; null means the offset is per deal (entered as offset_days).
  derive_from   text references deadline_types(code),
  derive_days   integer,
  business_days boolean not null default false,
  sort_order    integer not null default 100
);
alter table deadline_types enable row level security;

insert into deadline_types (code, label, family, is_money, derive_from, derive_days, business_days, sort_order) values
  ('la_expiration',        'Listing agreement expires',         'listing',  false, null,            null, false, 10),
  ('la_tail_end',          'Post-term tail ends',               'listing',  false, 'la_expiration', 120,  false, 11),
  ('prospect_list_due',    'Existing Prospect List due',        'listing',  false, 'la_expiration', 15,   true,  12),
  ('la_extension_due',     'Listing extension to be signed',    'listing',  false, null,            null, false, 13),
  ('pa_effective',         'Purchase agreement effective',      'purchase', false, null,            null, false, 20),
  ('deposit_due',          'Earnest money / escrow deposit due','purchase', true,  'pa_effective',  null, false, 21),
  ('dd_expiration',        'Due diligence expires',             'purchase', false, null,            null, false, 22),
  ('title_objection',      'Title objections due',              'purchase', false, null,            null, false, 23),
  ('survey_objection',     'Survey objections due',             'purchase', false, null,            null, false, 24),
  ('dd_status_report',     'DD status report due',              'purchase', false, null,            null, false, 25),
  ('financing_contingency','Financing contingency expires',     'purchase', false, null,            null, false, 26),
  ('closing',              'Closing',                           'purchase', true,  null,            null, false, 27),
  ('outside_closing',      'Outside closing date',              'purchase', false, null,            null, false, 28),
  ('loi_expiration',       'LOI expires',                       'lease',    false, null,            null, false, 30),
  ('security_deposit_due', 'Security deposit due',              'lease',    true,  null,            null, false, 31),
  ('first_rent_due',       'First month''s rent due',           'lease',    true,  null,            null, false, 32),
  ('delivery',             'Delivery',                          'lease',    false, null,            null, false, 33),
  ('rent_commencement',    'Rent commencement',                 'lease',    false, null,            null, false, 34),
  ('option_notice',        'Option notice deadline',            'lease',    false, null,            null, false, 35),
  ('other',                'Other deadline',                    'other',    false, null,            null, false, 99)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Warning rules — one row per lead time, for project deadlines AND for
--    lease events on client leases. `lead` is an interval so 13 months is 13
--    months, not 395 days. A lead of 0 is the due-day warning. A type with no
--    rules never warns: pa_effective is an anchor (it dates the deposit), not
--    an action.
-- ---------------------------------------------------------------------------
create table if not exists deadline_warning_rules (
  id          uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('project_deadline', 'lease_event')),
  type_key    text not null,   -- deadline_types.code, or lease_events.event_type
  lead        interval not null,
  lead_label  text not null,   -- '90 days', '13 months', 'due'
  unique (source_kind, type_key, lead)
);
alter table deadline_warning_rules enable row level security;

insert into deadline_warning_rules (source_kind, type_key, lead, lead_label)
select 'project_deadline', v.type_key, v.lead::interval, v.lead_label
  from (values
    -- Dan's rulings
    ('la_expiration',        '90 days', '90 days'), ('la_expiration', '60 days', '60 days'),
    ('la_expiration',        '30 days', '30 days'), ('la_expiration', '0 days',  'due'),
    ('deposit_due',          '3 days',  '3 days'),  ('deposit_due',   '0 days',  'due'),
    ('security_deposit_due', '3 days',  '3 days'),  ('security_deposit_due', '0 days', 'due'),
    ('first_rent_due',       '3 days',  '3 days'),  ('first_rent_due','0 days',  'due'),
    ('option_notice',        '90 days', '90 days'), ('option_notice', '30 days', '30 days'),
    ('option_notice',        '0 days',  'due'),
    -- Defaults (Claude, 9/29/2026) — edit these rows to change them
    ('la_tail_end',          '30 days', '30 days'), ('la_tail_end',   '7 days',  '7 days'),
    ('la_tail_end',          '0 days',  'due'),
    ('prospect_list_due',    '7 days',  '7 days'),  ('prospect_list_due', '1 day', '1 day'),
    ('prospect_list_due',    '0 days',  'due'),
    ('la_extension_due',     '30 days', '30 days'), ('la_extension_due', '7 days', '7 days'),
    ('la_extension_due',     '0 days',  'due'),
    ('dd_expiration',        '30 days', '30 days'), ('dd_expiration', '7 days',  '7 days'),
    ('dd_expiration',        '0 days',  'due'),
    ('title_objection',      '7 days',  '7 days'),  ('title_objection', '1 day', '1 day'),
    ('title_objection',      '0 days',  'due'),
    ('survey_objection',     '7 days',  '7 days'),  ('survey_objection', '1 day', '1 day'),
    ('survey_objection',     '0 days',  'due'),
    ('dd_status_report',     '7 days',  '7 days'),  ('dd_status_report', '0 days', 'due'),
    ('financing_contingency','14 days', '14 days'), ('financing_contingency', '3 days', '3 days'),
    ('financing_contingency','0 days',  'due'),
    ('closing',              '30 days', '30 days'), ('closing',       '7 days',  '7 days'),
    ('closing',              '0 days',  'due'),
    ('outside_closing',      '60 days', '60 days'), ('outside_closing', '30 days', '30 days'),
    ('outside_closing',      '0 days',  'due'),
    ('loi_expiration',       '3 days',  '3 days'),  ('loi_expiration', '0 days',  'due'),
    ('delivery',             '14 days', '14 days'), ('delivery',      '3 days',  '3 days'),
    ('delivery',             '0 days',  'due'),
    ('rent_commencement',    '30 days', '30 days'), ('rent_commencement', '7 days', '7 days'),
    ('rent_commencement',    '0 days',  'due'),
    ('other',                '7 days',  '7 days'),  ('other',         '0 days',  'due')
  ) as v(type_key, lead, lead_label)
on conflict do nothing;

insert into deadline_warning_rules (source_kind, type_key, lead, lead_label) values
  ('lease_event', 'Lease Expiration',       '13 months', '13 months'),
  ('lease_event', 'Option Notice Deadline', '90 days',   '90 days'),
  ('lease_event', 'Option Notice Deadline', '30 days',   '30 days'),
  ('lease_event', 'Option Notice Deadline', '0 days',    'due')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Project deadlines — shaped like lease_events, keyed to a project.
-- ---------------------------------------------------------------------------
create table if not exists project_deadlines (
  id               uuid primary key default gen_random_uuid(),
  display_code     text unique,                     -- DL-0001
  project_id       uuid not null references projects(id) on delete cascade,
  deadline_type    text not null references deadline_types(code),
  deadline_date    date,                            -- null = not known yet
  amount           numeric,
  offset_days      integer check (offset_days is null or offset_days >= 0),
  -- For a derived row: the anchor it follows. The date recomputes when the
  -- anchor moves, unless someone set this row's date directly.
  derived_from_id  uuid references project_deadlines(id) on delete cascade,
  date_overridden  boolean not null default false,
  is_completed     boolean not null default false,
  completed_at     timestamptz,
  notes            text,
  source_document  text,                            -- e.g. 'Ex LA - Exp 12.30.26.pdf, §3'
  source_system    text,
  source_record_id text,
  source_batch_id  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_project_deadlines_project on project_deadlines(project_id);
create index if not exists idx_project_deadlines_date on project_deadlines(deadline_date) where not is_completed;
create unique index if not exists idx_project_deadlines_derived
  on project_deadlines(derived_from_id, deadline_type) where derived_from_id is not null;
create unique index if not exists idx_project_deadlines_source_record
  on project_deadlines(source_system, source_record_id) where source_record_id is not null;
alter table project_deadlines enable row level security;

insert into display_code_counters (prefix, last_value) values ('DL', 0)
on conflict (prefix) do nothing;

-- Weekends skipped; holidays are not (a known limit — check the agreement's
-- own definition of business day when it matters).
create or replace function add_business_days(p_date date, p_days integer)
returns date
language plpgsql
immutable
as $$
declare
  d date := p_date;
  n integer := 0;
begin
  while n < p_days loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  return d;
end;
$$;

-- Keeps derived rows in step with their anchor.
create or replace function project_deadlines_derive()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  t record;
  v_offset integer;
  v_date date;
begin
  -- A completed anchor still anchors (an expired LA still starts the tail).
  for t in select * from deadline_types where derive_from = new.deadline_type loop
    v_offset := coalesce(t.derive_days,
                         (select offset_days from project_deadlines
                           where derived_from_id = new.id and deadline_type = t.code));
    v_date := case
      when new.deadline_date is null or v_offset is null then null
      when t.business_days then add_business_days(new.deadline_date, v_offset)
      else new.deadline_date + v_offset
    end;

    if exists (select 1 from project_deadlines
                where derived_from_id = new.id and deadline_type = t.code) then
      update project_deadlines
         set deadline_date = v_date, updated_at = now()
       where derived_from_id = new.id and deadline_type = t.code
         and not date_overridden
         and deadline_date is distinct from v_date;
    else
      insert into project_deadlines
        (display_code, project_id, deadline_type, deadline_date, offset_days,
         derived_from_id, notes, source_batch_id)
      values
        (next_display_code('project_deadlines', 'DL'), new.project_id, t.code, v_date,
         case when t.derive_days is null then null else t.derive_days end, new.id,
         case when v_offset is null
              then 'Derived from ' || coalesce(new.display_code, 'its anchor') ||
                   '. Enter the number of days the agreement allows (offset_days) to date it.'
              else 'Derived from ' || coalesce(new.display_code, 'its anchor') || ': ' ||
                   v_offset || case when t.business_days then ' business days' else ' days' end ||
                   ' after.'
         end,
         new.source_batch_id);
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_project_deadlines_derive on project_deadlines;
create trigger trg_project_deadlines_derive
  after insert or update of deadline_date on project_deadlines
  for each row execute function project_deadlines_derive();

-- A derived row whose offset is entered or changed dates itself from its anchor.
create or replace function project_deadlines_offset()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  a record;
  t record;
begin
  if new.derived_from_id is null or new.date_overridden then return new; end if;
  if tg_op = 'UPDATE' and new.offset_days is not distinct from old.offset_days then return new; end if;
  select * into a from project_deadlines where id = new.derived_from_id;
  select * into t from deadline_types where code = new.deadline_type;
  if a.deadline_date is not null and new.offset_days is not null then
    new.deadline_date := case when t.business_days
                              then add_business_days(a.deadline_date, new.offset_days)
                              else a.deadline_date + new.offset_days end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_project_deadlines_offset on project_deadlines;
create trigger trg_project_deadlines_offset
  before update of offset_days on project_deadlines
  for each row execute function project_deadlines_offset();

-- ---------------------------------------------------------------------------
-- 5. Client leases — derived, never declared.
-- ---------------------------------------------------------------------------
create or replace view client_leases as
with client_projects as (
  select id, client_entity_id, project_type
    from projects
   where status in ('active', 'closed_won') and client_entity_id is not null
),
listing_projects as (
  select * from client_projects
   where split_part(project_type, '/', 1) in ('CL', 'CS', 'L', 'SL', 'LRLL')
),
listing_properties as (
  select pp.property_id, lp.id as project_id
    from project_properties pp join listing_projects lp on lp.id = pp.project_id
  union
  select po.property_id, lp.id
    from property_owner po join listing_projects lp on lp.client_entity_id = po.entity_id
   where po.is_current
)
select l.id as lease_id, 'tenant is a client'::text as reason, cp.id as project_id
  from leases l join client_projects cp on cp.client_entity_id = l.tenant_entity_id
 where l.is_current
union
select l.id, 'landlord is a listing client', lp.id
  from leases l join listing_projects lp on lp.client_entity_id = l.landlord_entity_id
 where l.is_current
union
select l.id, 'building is on a listing', lpp.project_id
  from leases l
  join spaces s on s.id = l.space_id
  join listing_properties lpp on lpp.property_id = s.property_id
 where l.is_current;

-- ---------------------------------------------------------------------------
-- 6. Warnings — the log that makes the generator idempotent.
-- ---------------------------------------------------------------------------
create table if not exists deadline_warnings (
  id          uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('project_deadline', 'lease_event')),
  source_id   uuid not null,
  due_date    date not null,     -- the date warned about; a moved date warns afresh
  lead_label  text not null,
  task_id     uuid references tasks(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (source_kind, source_id, due_date, lead_label)
);
create index if not exists idx_deadline_warnings_task on deadline_warnings(task_id);
alter table deadline_warnings enable row level security;

create or replace function deadline_when_text(p_due date, p_today date)
returns text
language sql
immutable
as $$
  select case
    when p_due = p_today then 'today'
    when p_due = p_today + 1 then 'tomorrow'
    when p_due > p_today then 'in ' || (p_due - p_today) || ' days'
    when p_due = p_today - 1 then 'was yesterday'
    else (p_today - p_due) || ' days ago'
  end || ' (' || extract(month from p_due) || '/' || extract(day from p_due) || '/' ||
         to_char(p_due, 'YY') || ')';
$$;

-- Returns the number of warnings issued. Safe to run any number of times a day.
create or replace function generate_deadline_warnings(
  p_today date default (now() at time zone 'America/Chicago')::date
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_rule record;
  v_task_id uuid;
  v_open_task uuid;
  v_title text;
  v_desc text;
  v_count integer := 0;
begin
  -- Project deadlines: open, dated. Overdue ones warn too (lead 'due').
  for r in
    select d.id, d.display_code, d.deadline_type, d.deadline_date, d.amount, d.notes, d.project_id,
           t.label, p.project_code, p.client_entity_id
      from project_deadlines d
      join deadline_types t on t.code = d.deadline_type
      join projects p on p.id = d.project_id
     where not d.is_completed and d.deadline_date is not null
       and coalesce(p.status, 'active') <> 'closed_lost'
  loop
    -- The nearest lead whose warning date has arrived.
    select * into v_rule
      from deadline_warning_rules w
     where w.source_kind = 'project_deadline'
       and w.type_key = r.deadline_type
       and (r.deadline_date - w.lead)::date <= p_today
     order by w.lead asc
     limit 1;
    continue when not found;
    continue when exists (select 1 from deadline_warnings
                           where source_kind = 'project_deadline' and source_id = r.id
                             and due_date = r.deadline_date and lead_label = v_rule.lead_label);

    v_title := left(split_part(r.project_code, ' - ', 1) || ' — ' || r.label || ' ' ||
                    deadline_when_text(r.deadline_date, p_today), 120);
    v_desc := r.label || ' on ' || to_char(r.deadline_date, 'FMMM/FMDD/YYYY') ||
              ' for ' || r.project_code || ' (' || coalesce(r.display_code, 'deadline') || ')' ||
              case when r.amount is not null then ', amount $' || to_char(r.amount, 'FM999,999,999.00') else '' end ||
              '. ' || coalesce(r.notes, '') ||
              ' Mark the deadline done on the project page once it is handled; that closes this task.';

    select dw.task_id into v_open_task
      from deadline_warnings dw join tasks tk on tk.id = dw.task_id
     where dw.source_kind = 'project_deadline' and dw.source_id = r.id and tk.status = 'open'
     order by dw.created_at desc limit 1;

    if v_open_task is not null then
      update tasks set title = v_title, description = v_desc, due_date = p_today, updated_at = now()
       where id = v_open_task;
      v_task_id := v_open_task;
    else
      insert into tasks (display_code, title, description, due_date, status, project_id,
                         entity_id, category)
      values (next_display_code('tasks', 'TASK'), v_title, v_desc, p_today, 'open', r.project_id,
              r.client_entity_id, 'deadline')
      returning id into v_task_id;
    end if;

    insert into deadline_warnings (source_kind, source_id, due_date, lead_label, task_id)
    values ('project_deadline', r.id, r.deadline_date, v_rule.lead_label, v_task_id)
    on conflict do nothing;
    v_count := v_count + 1;
  end loop;

  -- Lease events on client leases: only future or due-today dates. A lease
  -- date already past is Looking Ahead's "past, never marked done" list.
  for r in
    select e.id, e.display_code, e.event_type, e.event_date, e.lease_id,
           l.tenant_entity_id, s.property_id,
           coalesce(en.trade_name, en.name, 'Tenant') as tenant_name,
           pr.address,
           (select cl.project_id from client_leases cl where cl.lease_id = l.id limit 1) as project_id
      from lease_events e
      join leases l on l.id = e.lease_id
      join spaces s on s.id = l.space_id
      join properties pr on pr.id = s.property_id
      left join entities en on en.id = l.tenant_entity_id
     where not e.is_completed and e.event_date is not null and e.event_date >= p_today
       and exists (select 1 from client_leases cl where cl.lease_id = l.id)
  loop
    select * into v_rule
      from deadline_warning_rules w
     where w.source_kind = 'lease_event' and w.type_key = r.event_type
       and (r.event_date - w.lead)::date <= p_today
     order by w.lead asc
     limit 1;
    continue when not found;
    continue when exists (select 1 from deadline_warnings
                           where source_kind = 'lease_event' and source_id = r.id
                             and due_date = r.event_date and lead_label = v_rule.lead_label);

    v_title := left(r.tenant_name || ', ' || r.address || ' — ' ||
                    lower(r.event_type) || ' ' || deadline_when_text(r.event_date, p_today), 120);
    v_desc := r.event_type || ' on ' || to_char(r.event_date, 'FMMM/FMDD/YYYY') || ' — ' ||
              r.tenant_name || ', ' || r.address || ' (' || coalesce(r.display_code, 'lease event') ||
              '). Client lease: raise renewal, relocation or option timing with the client. ' ||
              'Mark the lease event done once handled; that closes this task.';

    select dw.task_id into v_open_task
      from deadline_warnings dw join tasks tk on tk.id = dw.task_id
     where dw.source_kind = 'lease_event' and dw.source_id = r.id and tk.status = 'open'
     order by dw.created_at desc limit 1;

    if v_open_task is not null then
      update tasks set title = v_title, description = v_desc, due_date = p_today, updated_at = now()
       where id = v_open_task;
      v_task_id := v_open_task;
    else
      insert into tasks (display_code, title, description, due_date, status, project_id,
                         entity_id, property_id, category)
      values (next_display_code('tasks', 'TASK'), v_title, v_desc, p_today, 'open', null,
              r.tenant_entity_id, r.property_id, 'lease date')
      returning id into v_task_id;
    end if;

    insert into deadline_warnings (source_kind, source_id, due_date, lead_label, task_id)
    values ('lease_event', r.id, r.event_date, v_rule.lead_label, v_task_id)
    on conflict do nothing;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Completing a deadline or lease event closes its open warning task.
create or replace function close_warning_tasks()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_kind text := case tg_table_name when 'project_deadlines' then 'project_deadline' else 'lease_event' end;
begin
  if new.is_completed and not old.is_completed then
    update tasks set status = 'done', completed_at = now(), updated_at = now()
     where status = 'open'
       and id in (select task_id from deadline_warnings
                   where source_kind = v_kind and source_id = new.id and task_id is not null);
    if tg_table_name = 'project_deadlines' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  elsif tg_table_name = 'project_deadlines' and not new.is_completed then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_project_deadlines_close on project_deadlines;
create trigger trg_project_deadlines_close
  before update of is_completed on project_deadlines
  for each row execute function close_warning_tasks();

drop trigger if exists trg_lease_events_close on lease_events;
create trigger trg_lease_events_close
  before update of is_completed on lease_events
  for each row execute function close_warning_tasks();

-- Deleting a deadline (entered in error) cancels its open warning task.
create or replace function cancel_warning_tasks_on_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update tasks set status = 'cancelled', updated_at = now()
   where status = 'open'
     and id in (select task_id from deadline_warnings
                 where source_kind = 'project_deadline' and source_id = old.id and task_id is not null);
  delete from deadline_warnings where source_kind = 'project_deadline' and source_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_project_deadlines_delete on project_deadlines;
create trigger trg_project_deadlines_delete
  after delete on project_deadlines
  for each row execute function cancel_warning_tasks_on_delete();

-- ---------------------------------------------------------------------------
-- 7. Close-out hook: a tenant-side deal marked won gets an "enter the
--    executed lease" task (9/26/2026 — executed leases weren't reliably
--    entered at close-out).
-- ---------------------------------------------------------------------------
create or replace function projects_closeout_lease_task()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'closed_won' and old.status is distinct from 'closed_won'
     and split_part(new.project_type, '/', 1) in ('TR', 'LRT') then
    insert into tasks (display_code, title, description, due_date, status, project_id,
                       entity_id, category)
    values (next_display_code('tasks', 'TASK'),
            left(split_part(new.project_code, ' - ', 1) || ' — enter the executed lease', 120),
            'Deal marked won. Enter the executed lease in the CRM (space, lease terms, and the '
              || 'critical dates as lease events: expiration, option notice deadline, rent '
              || 'commencement, bumps), and file the signed copy in Dropbox.'
              || case when new.project_type like '%/%'
                      then ' If this client bought rather than leased, cancel this task.' else '' end,
            (now() at time zone 'America/Chicago')::date, 'open', new.id, new.client_entity_id,
            'close-out');
  end if;
  return null;
end;
$$;

drop trigger if exists trg_projects_closeout on projects;
create trigger trg_projects_closeout
  after update of status on projects
  for each row execute function projects_closeout_lease_task();

commit;

-- VERIFICATION — run after the block above. Expected: one row,
--   clients_linked = 17 | deadline_types = 20 | rules = 56 | has_view = true
--   | dl_counter = true | generator_runs = true
select
  (select count(*) from projects where client_entity_id is not null)       as clients_linked,
  (select count(*) from deadline_types)                                     as deadline_types,
  (select count(*) from deadline_warning_rules)                             as rules,
  exists (select 1 from information_schema.views where table_name = 'client_leases') as has_view,
  exists (select 1 from display_code_counters where prefix = 'DL')          as dl_counter,
  (generate_deadline_warnings() >= 0)                                       as generator_runs;
