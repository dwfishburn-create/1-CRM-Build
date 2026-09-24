-- Dan Fishburn CRM — v1 schema, migration 018
-- Provenance columns (Tier B #6), and the link that lets a logged next step
-- become a task.
--
-- Two unrelated-looking things ship together because both are prerequisites
-- for working out of the CRM instead of a spreadsheet, and both were found
-- the same way: by putting one real row (SalonCentric, 9/24/2026) through the
-- whole flow and watching where it fell through.
--
-- ---------------------------------------------------------------------------
-- Part 1 — provenance. Tier B #6, approved 9/22/2026, never built.
--
-- What happened without it: SalonCentric was entered by hand ahead of the
-- RealNex migration, and its RealNex space key
-- (ef4d5253-2f4c-4794-a37f-1e1e27a1f7e0) ended up written into the `notes`
-- field of four different records as prose. That is the same anti-pattern
-- this CRM keeps rediscovering — meaning parked in free text where nothing
-- can query it — and it has a specific consequence: when the import runs, it
-- creates its own property, space and lease for that key, and nothing
-- structural connects them to the rows already there. The duplicate check
-- would flag the property (016/017 do their job), but a human still has to
-- notice and merge.
--
-- source_record_id is the foreign system's own key. source_batch_id is what
-- makes a bad load reversible: every row from one import run carries the same
-- batch id, so "undo that batch" is a delete on one column rather than an
-- archaeology exercise.
--
-- The unique index per table is what makes an import re-runnable. Import the
-- same RealNex space twice and the second attempt collides instead of
-- silently duplicating. It is partial (source_record_id not null) because
-- hand-entered rows have no source and must not collide with each other.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'contacts', 'entities', 'properties', 'spaces', 'leases', 'lease_events',
    'activity_log', 'sale_comps', 'lease_comps', 'projects',
    'property_owner', 'property_tenant', 'tasks', 'requirements'
  ]
  loop
    execute format(
      'alter table %I
         add column if not exists source_system text,
         add column if not exists source_record_id text,
         add column if not exists source_batch_id text', t);

    execute format(
      'create unique index if not exists idx_%s_source_record
         on %I (source_system, source_record_id)
        where source_record_id is not null', t, t);

    execute format(
      'create index if not exists idx_%s_source_batch
         on %I (source_batch_id) where source_batch_id is not null', t, t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Part 2 — tasks.source_activity_id
--
-- The problem this solves, found 9/24/2026 by looking at the live Dashboard:
-- "Your move" reads the `tasks` table, while log_activity writes its
-- follow-up into activity_log.next_step. Two competing answers to "what's
-- next", and only one of them reaches the screen Dan looks at each morning.
-- A next step recorded on LOG-0173 ("call Kevin Higgins, due 9/25") was
-- invisible on the Dashboard.
--
-- The rule adopted (Dan's call, 9/24/2026): one concept, two records. The
-- activity is the HISTORY of what was agreed; the task is the QUEUE. Logging
-- an activity that carries BOTH a next step and a due date creates the task
-- automatically. No due date, no task — "call him back eventually" is a note,
-- not a queue item, and that distinction is what keeps the Dashboard from
-- filling with things that were never really commitments.
--
-- source_activity_id is the link back, so the task can show where it came
-- from and so the same activity never spawns two tasks.
-- ---------------------------------------------------------------------------
alter table tasks
  add column if not exists source_activity_id uuid
    references activity_log(id) on delete set null;

create unique index if not exists idx_tasks_source_activity
  on tasks (source_activity_id) where source_activity_id is not null;

-- ---------------------------------------------------------------------------
-- Part 3 — backfill the SalonCentric rows entered by hand on 9/24/2026.
--
-- Data in a migration is unusual and deliberate here: these five rows are the
-- only ones in the database carrying a foreign key in prose, they were created
-- hours before this migration, and leaving them to be fixed by hand is how
-- they stay wrong. Matched on display_code, which is stable.
--
-- All five carry the same RealNex space key because that is what they are:
-- one RealNex Spaces row unpacked into the property, space and lease it
-- actually describes. The unique index is per-table, so this is not a
-- collision.
-- ---------------------------------------------------------------------------
update properties set
    source_system = 'realnex',
    source_record_id = 'ef4d5253-2f4c-4794-a37f-1e1e27a1f7e0',
    source_batch_id = 'hand-2026-09-24-saloncentric'
  where display_code = 'PROP-0048' and source_record_id is null;

update spaces set
    source_system = 'realnex',
    source_record_id = 'ef4d5253-2f4c-4794-a37f-1e1e27a1f7e0',
    source_batch_id = 'hand-2026-09-24-saloncentric'
  where display_code = 'SPACE-0007' and source_record_id is null;

update leases set
    source_system = 'realnex',
    source_record_id = 'ef4d5253-2f4c-4794-a37f-1e1e27a1f7e0',
    source_batch_id = 'hand-2026-09-24-saloncentric'
  where display_code = 'LEASE-0006' and source_record_id is null;

update entities set
    source_system = 'realnex',
    source_record_id = 'ef4d5253-2f4c-4794-a37f-1e1e27a1f7e0:tenant',
    source_batch_id = 'hand-2026-09-24-saloncentric'
  where display_code = 'ENT-0068' and source_record_id is null;

update contacts set
    source_system = 'realnex',
    source_record_id = 'ef4d5253-2f4c-4794-a37f-1e1e27a1f7e0:contact',
    source_batch_id = 'hand-2026-09-24-saloncentric'
  where display_code = 'CON-0085' and source_record_id is null;
