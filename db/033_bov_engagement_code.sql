-- CRM - Dan Fishburn — migration 033: BOV engagement code (11/9/2026)
--
-- Dan added a ninth engagement code on 11/9/2026: BOV = Broker Opinion of
-- Value — an opinion of market value / valuation memo for a client, with no
-- transaction representation (no listing, no buy or lease side). It opens a
-- fourth family, Advisory, beside Search/Represent, Listing and Renewal.
-- First live use: BOV-Titan Machinery - McCook & Gordon NE (Titan's board
-- wants real estate split from goodwill on two dealerships in a business
-- acquisition; flat_fee, deal_price 0). The Lexington memo (10/27/2026) was
-- the first BOV but was done inside the BR/L engagement.
--
-- Blocker this clears: update_sop_matrix rejected project_type "BOV" (HTTP
-- 400), so get_sop_checklist("BOV") came back empty and a BOV Claude
-- Project's session-start SOP check loaded nothing.
--
-- Parts:
--   1. Widen sop_matrix_project_type_check to include BOV. (The app-side list
--      is lib/projectTypes.ts — the one source of truth in code. This
--      constraint is the only other copy, because SQL can't import it.)
--   2. Seed a BOV cell for every existing SOP row (Section 4 of
--      New_Project_Setup_and_Categorization_-_SOP.md): Property Survey Map =
--      Adapt (comps map, not candidates); everything else N/A.
--   3. Roadmap row "Client Broker Opinion of Value SOP" (no file yet): BOV =
--      Gap, every other code = N/A, so the missing memo-format SOP is
--      reportable rather than invisible.
--   4. Stamp sop_matrix_meta to the SOP doc's new "Last updated" (11/9/2026).
--
-- projects.project_type is still free text — no change needed there.
-- Safe to re-run (on conflict do nothing / idempotent constraint swap).
-- Run before or after the code deploy; both orders work.

begin;

-- 1. -------------------------------------------------------------------------
alter table sop_matrix drop constraint if exists sop_matrix_project_type_check;
alter table sop_matrix add constraint sop_matrix_project_type_check
  check (project_type in ('TR', 'BR', 'CL', 'CS', 'L', 'LRT', 'LRLL', 'SL', 'BOV'));

-- 2. -------------------------------------------------------------------------
-- One BOV cell per existing SOP row, carrying that row's filename and
-- sort_order (read from its TR cell, which every row has).
insert into sop_matrix (sop_name, sop_filename, project_type, status, note, sort_order)
select m.sop_name,
       m.sop_filename,
       'BOV',
       case when m.sop_name = 'Client Property Survey Map SOP' then 'Adapt' else 'N/A' end,
       case when m.sop_name = 'Client Property Survey Map SOP'
            then 'comps map, not candidates' else null end,
       m.sort_order
  from sop_matrix m
 where m.project_type = 'TR'
on conflict (sop_name, project_type) do nothing;

-- 3. -------------------------------------------------------------------------
insert into sop_matrix (sop_name, sop_filename, project_type, status, note, sort_order)
select 'Client Broker Opinion of Value SOP',
       null,
       t.code,
       case when t.code = 'BOV' then 'Gap' else 'N/A' end,
       case when t.code = 'BOV'
            then 'Roadmap item, not yet written (added 11/9/2026). Draft basis: the Lexington memo '
                 || '(10/27/2026), the McCook/Gordon memo, and Dan''s historical BOVs.'
            else null end,
       (select coalesce(max(sort_order), 0) + 10 from sop_matrix)
  from unnest(array['TR', 'BR', 'CL', 'CS', 'L', 'LRT', 'LRLL', 'SL', 'BOV']) as t(code)
on conflict (sop_name, project_type) do nothing;

-- 4. -------------------------------------------------------------------------
update sop_matrix_meta
   set source_doc_last_updated = date '2026-11-09',
       source_last_synced      = date '2026-11-09',
       updated_at              = now()
 where id = 1;

commit;

-- Check:
--   select sop_name, status, note from sop_matrix where project_type = 'BOV' order by sort_order;
--   -- expect 11 rows: Survey Map = Adapt, Broker Opinion of Value SOP = Gap, the rest N/A
--   select project_type, count(*) from sop_matrix group by 1 order by 1;
--   -- expect 11 per code, 99 total
