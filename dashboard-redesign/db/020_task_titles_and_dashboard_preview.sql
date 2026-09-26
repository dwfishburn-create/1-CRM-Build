-- 020 — Dashboard redesign support (9/26/2026)
--
-- 1. tasks.title: a short one-line label. The redesigned Dashboard shows one
--    line per item; the full description only appears when a row is opened.
--    Nullable — the Dashboard falls back to a shortened description.
-- 2. dashboard_preview_dismissals: remembers the weeks whose Preview Dan
--    retired with "Got it", so the retirement holds across devices.
-- 3. Titles for the 19 tasks open on 9/26/2026, by id. Only fills blanks.
--
-- Numbered 020, not 019: 019 is the one-off provenance backfill script
-- (019_backfill_provenance_2026-09-24_rows.sql, run 9/25/2026).

begin;

alter table tasks add column if not exists title text;

create table if not exists dashboard_preview_dismissals (
  week_start   date primary key,          -- the Monday of the week being previewed
  dismissed_at timestamptz not null default now()
);
alter table dashboard_preview_dismissals enable row level security;

update tasks t set title = v.title
from (values
  ('daf228e3-7756-4dd8-b066-f77e9209e238'::uuid, 'Krenzien — call Brad re the $925K offer'),
  ('d7d20837-1904-43cd-b569-7e79d6ea25e0'::uuid, 'Krenzien — get the listing extension signed, naming Wattiers'),
  ('0cd83b28-b0f9-4eab-99d0-4be3a6a80210'::uuid, 'Katrina — Scottsbluff renewal + ask for the 4704 lease'),
  ('b215e8fa-36b6-41d1-928f-b18bdcd10e17'::uuid, 'Wingstop — find the franchisee, confirm the option date'),
  ('bc9c3474-ca7d-4368-bdf2-608c2122a59f'::uuid, 'Pure Air Tech — renewal call'),
  ('cea22b90-b7ad-40f9-8069-f0c083d313ff'::uuid, 'ABM Janitorial — staying, expanding or leaving?'),
  ('76163cd3-ce36-4c27-947b-bd23aa93eba5'::uuid, 'Massage Envy — find the franchisee, option status'),
  ('64e3d384-c83f-4e81-b778-038a69ab702b'::uuid, 'Pacific Hills Dental — find the option notice period'),
  ('999dea98-9a20-4c58-ac85-e18704071bd4'::uuid, '11229 W Dodge — confirm the occupant'),
  ('d196da27-70d1-4127-ac24-8f6d36c8d60b'::uuid, 'AC Chiropractic — call Mark Galvin re renewal'),
  ('fb954b09-9735-4495-8c53-2e86e0697978'::uuid, 'Kaizen — ask Tom whether they''re renewing'),
  ('1283cffb-c8e9-41a8-b93b-2120cc4d4111'::uuid, 'Smokin'' Oak — find the operator, renewal call'),
  ('009fc731-d310-47ca-a7a3-2a121e1ce50d'::uuid, 'Team Car Care — was the $4K/mo option exercised?'),
  ('146291c0-5df9-44e3-af9f-316cea3a444e'::uuid, 'McIntyre Orthodontics — renewing or moving?'),
  ('7a86625e-3509-4641-b889-8c040c117df0'::uuid, 'Pine Lake option status'),
  ('655e9fba-40dc-4f76-8e5f-1bb46f1afd47'::uuid, 'Pine Lake option — ask Katrina'),
  ('5e05c00b-bab7-4396-8122-040d02874860'::uuid, 'Hy-Vee, 13220 Birch — was the option exercised?'),
  ('200526b7-0abc-433e-847b-2dcfc4cb51d9'::uuid, 'Seneca — resolve the option-date conflict'),
  ('4c53b44c-c5ff-4460-8328-b07e6e623569'::uuid, 'Sola Salon — option status, Clocktower')
) as v(id, title)
where t.id = v.id and t.title is null;

commit;

-- VERIFICATION — run after the block above. Expected: one row,
--   has_title_column = true | has_dismissals_table = true | titled_open_tasks = 19
select
  exists (select 1 from information_schema.columns
          where table_name = 'tasks' and column_name = 'title')      as has_title_column,
  exists (select 1 from information_schema.tables
          where table_name = 'dashboard_preview_dismissals')         as has_dismissals_table,
  (select count(*) from tasks where status = 'open' and title is not null) as titled_open_tasks;
