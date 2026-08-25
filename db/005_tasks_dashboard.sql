-- Dan Fishburn CRM — v1 schema, migration 005
-- Tasks/reminder engine + Dashboard, per the design in
-- CRM_Requirements_and_Decisions_Log.md (8/22/2026-8/23/2026 entries) and
-- the 8/25/2026 build-order decision (Requirements -> Tasks/Dashboard ->
-- Sale/Lease Comps as-needed). Built as one unit because the Dashboard has
-- a hard dependency on these columns existing.
--
-- Dashboard's job: a daily "ball in court" triage view, not a generic
-- activity feed — for every open task, who owns the next move? Dan
-- (waiting_on_contact_id is null), or a specific contact (set). Tasks stay
-- entity-optional (a task can stand alone — Dan's own example: a real
-- estate license renewal reminder with no CRM entity attached) and
-- `category` stays freeform text, no DB enum, matching the philosophy
-- already used for activity_type/deal_type/property_type.
--
-- Recurrence (for renewal-type reminders): a simple unit + interval pair
-- (e.g. "every 1 year", "every 2 weeks") rather than full cron-style rules —
-- exact design was left open in the 8/23 entry ("not just one-off
-- follow-ups... exact recurrence design not yet finalized"); this is the
-- simplest thing that covers the stated use case. Completing a recurring
-- task auto-creates the next occurrence (see lib/tasks.ts:completeTask) —
-- revisit if Dan needs anything fancier (specific weekday, month-end, etc.).
--
-- `tasks` has been live since 001_init_schema.sql but no screen or API
-- route has ever written to it — confirmed empty, so this is a plain
-- additive migration (no data to preserve or backfill).

alter table tasks
  add column display_code text unique, -- TASK-0001, same convention as every other table
  add column requirement_id uuid references requirements(id) on delete set null,
  add column waiting_on_contact_id uuid references contacts(id) on delete set null,
  -- null = Dan's move (the default). Set = waiting on that contact — links to
  -- a real contacts row, not a free-text name, so the Dashboard can group by
  -- who Dan is waiting on across all his active work (per the Dashboard
  -- design decision).
  add column category text, -- call / email / follow-up / showing / license_renewal / admin — freeform, Dan defines his own as needed
  add column recurrence_unit text not null default 'none'
    check (recurrence_unit in ('none', 'day', 'week', 'month', 'year')),
  add column recurrence_interval integer not null default 1
    check (recurrence_interval >= 1),
  add column parent_task_id uuid references tasks(id) on delete set null,
  -- links a recurring task's instances together (each completion spawns the
  -- next occurrence with parent_task_id set to the original task's id)
  add column completed_at timestamptz;

create index idx_tasks_requirement on tasks(requirement_id);
create index idx_tasks_waiting_on on tasks(waiting_on_contact_id);
create index idx_tasks_parent on tasks(parent_task_id);
create index idx_tasks_category on tasks(category);
