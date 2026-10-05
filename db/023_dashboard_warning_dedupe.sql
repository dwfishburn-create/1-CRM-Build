-- 023 — Dashboard fixes after the first week of live use (10/5/2026)
--
-- Why: on 10/5/2026 the live Dashboard showed 24 items, 19 overdue, and the
-- same lease appearing twice — a warning task from the generator sitting next
-- to the task Dan had already written about that lease (Kaizen, Birch Dr,
-- Scottsbluff, Pine Lake). The generator never looked for an existing task.
-- This is the "same conversation as two or three tasks" problem the 9/26
-- redesign set out to kill, coming back through the warnings.
--
-- What this changes:
--   1. deadline_warnings.attached — true when a warning was recorded against
--      a task Dan already had, rather than a task the generator created.
--   2. covering_task_for_lease_event() — an open task on the same property
--      and the same tenant entity, due on or before the lease date, covers
--      the warning. The generator records the warning against it and leaves
--      Dan's task exactly as he set it (title, description, date untouched).
--      A task due AFTER the lease date does not cover it: a warning about a
--      date Dan's own follow-up would miss still gets its own task.
--   3. generate_deadline_warnings() — the lease-event branch uses (2); both
--      branches only ever re-date and re-title tasks the generator created.
--      Warning text now says what the two buttons do: "Got it" clears the
--      reminder (the next lead time still warns), "handled" marks the date
--      itself done and ends its warnings.
--   4. One-time cleanup: every open generator task that an existing task
--      already covers is cancelled (kept, not deleted) and its warning is
--      re-pointed at the covering task. Expected in production on 10/5/2026:
--      4 — TASK-0027 (Kaizen -> TASK-0010), TASK-0029 (Pine Lake expiration
--      -> TASK-0005), TASK-0031 (Birch Dr -> TASK-0004), TASK-0032
--      (Scottsbluff -> TASK-0018). TASK-0030 (Pine Lake option notice, 9/30)
--      stays: Dan's follow-ups are dated 10/29, after the deadline.
--
-- Completing a lease event still closes whatever task its warnings point at,
-- including a covering task — marking the lease date handled means the
-- conversation about it is done.
--
-- Project deadlines are unchanged: their warning tasks carry the project, and
-- the Dashboard already folds every task on a project into one row.
--
-- Apply in the Supabase SQL editor, then run the VERIFICATION query at the
-- bottom, then `notify pgrst, 'reload schema';`.

begin;

alter table deadline_warnings
  add column if not exists attached boolean not null default false;

-- An open task Dan already has on this lease: same property, same tenant,
-- due on or before the lease date (or undated). Tasks the generator created
-- never count. Your Move before Waiting On, then the earliest.
create or replace function covering_task_for_lease_event(p_event_id uuid)
returns uuid
language sql
stable
set search_path = public
as $$
  select tk.id
    from lease_events e
    join leases l on l.id = e.lease_id
    join spaces s on s.id = l.space_id
    join tasks tk on tk.property_id = s.property_id
                 and tk.entity_id = l.tenant_entity_id
   where e.id = p_event_id
     and tk.status = 'open'
     and (tk.due_date is null or tk.due_date <= e.event_date)
     and not exists (select 1 from deadline_warnings dw
                      where dw.task_id = tk.id and not dw.attached)
   order by (tk.waiting_on_contact_id is not null), tk.due_date nulls last, tk.created_at
   limit 1;
$$;

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
  v_attached boolean := false;
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
              ' "Got it" clears this reminder; the next lead time still warns. "Deadline handled" marks the date itself done and ends its warnings.';

    select dw.task_id into v_open_task
      from deadline_warnings dw join tasks tk on tk.id = dw.task_id
     where dw.source_kind = 'project_deadline' and dw.source_id = r.id and tk.status = 'open'
       and not dw.attached
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
              '"Got it" clears this reminder; the next lead time still warns. "Lease date handled" marks the date itself done and ends its warnings.';

    select dw.task_id into v_open_task
      from deadline_warnings dw join tasks tk on tk.id = dw.task_id
     where dw.source_kind = 'lease_event' and dw.source_id = r.id and tk.status = 'open'
       and not dw.attached
     order by dw.created_at desc limit 1;

    v_attached := false;
    if v_open_task is null then
      v_open_task := covering_task_for_lease_event(r.id);
      v_attached := v_open_task is not null;
    end if;

    if v_attached then
      -- Dan already has an open task on this lease: record the warning
      -- against it and leave his task exactly as he set it.
      v_task_id := v_open_task;
    elsif v_open_task is not null then
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

    insert into deadline_warnings (source_kind, source_id, due_date, lead_label, task_id, attached)
    values ('lease_event', r.id, r.event_date, v_rule.lead_label, v_task_id, v_attached)
    on conflict do nothing;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- One-time cleanup of the duplicates already on the Dashboard.
do $$
declare
  w record;
  v_cover uuid;
  v_cover_code text;
begin
  for w in
    select distinct dw.task_id, dw.source_id
      from deadline_warnings dw
      join tasks tk on tk.id = dw.task_id
     where dw.source_kind = 'lease_event' and not dw.attached and tk.status = 'open'
  loop
    v_cover := covering_task_for_lease_event(w.source_id);
    continue when v_cover is null;
    select display_code into v_cover_code from tasks where id = v_cover;

    update deadline_warnings
       set task_id = v_cover, attached = true
     where source_kind = 'lease_event' and task_id = w.task_id;

    update tasks
       set status = 'cancelled',
           description = description || ' [Cancelled 10/5/2026 by migration 023: duplicate of '
                         || coalesce(v_cover_code, 'an existing task') || ', which now carries this warning.]',
           updated_at = now()
     where id = w.task_id;
  end loop;
end;
$$;

-- Open generator tasks written before this migration still say "Mark the
-- lease event / deadline done ... that closes this task". Bring them in line.
update tasks
   set description = replace(description,
         'Mark the lease event done once handled; that closes this task.',
         '"Got it" clears this reminder; the next lead time still warns. "Lease date handled" marks the date itself done and ends its warnings.'),
       updated_at = now()
 where status = 'open' and description like '%Mark the lease event done once handled; that closes this task.%';

update tasks
   set description = replace(description,
         'Mark the deadline done on the project page once it is handled; that closes this task.',
         '"Got it" clears this reminder; the next lead time still warns. "Deadline handled" marks the date itself done and ends its warnings.'),
       updated_at = now()
 where status = 'open' and description like '%Mark the deadline done on the project page once it is handled; that closes this task.%';

commit;

-- VERIFICATION — run after the block above. Expected: has_attached = true,
-- has_cover_fn = true, generator_runs = true, and cancelled_by_023 listing
-- the four tasks named in the header (TASK-0027, -0029, -0031, -0032).
select
  exists (select 1 from information_schema.columns
           where table_name = 'deadline_warnings' and column_name = 'attached')  as has_attached,
  exists (select 1 from pg_proc where proname = 'covering_task_for_lease_event') as has_cover_fn,
  (generate_deadline_warnings() >= 0)                                             as generator_runs,
  (select string_agg(display_code, ', ' order by display_code) from tasks
    where status = 'cancelled' and description like '%migration 023%')           as cancelled_by_023;
