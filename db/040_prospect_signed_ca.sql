-- Dan Fishburn CRM — migration 040
-- Prospect Checklist: signed confidentiality agreement marker (11/18/2026, Dan:
-- "Can we add a 'color' for anyone that has provided a signed confidentiality
-- agreement?").
--
-- project_contacts.ca_signed_on — the date the prospect's signed CA came back
-- (null = no signed CA on file). ca_note — anything qualifying it (e.g. "broker
-- block only; buyer not named"). Shown on the checklist as a teal "CA ✓" tag —
-- teal = executed documents, the same color as Dan's deal timelines.
--
-- Backfill: CS-3167 Joliet Ave, from the files in
-- CA - 3167 Joliet Ave/Signed CAs/ (Dropbox, 11/18/2026).
--
-- Run in the Supabase SQL editor (Run without RLS), then:
--   notify pgrst, 'reload schema';

alter table project_contacts
  add column if not exists ca_signed_on date,
  add column if not exists ca_note text;

comment on column project_contacts.ca_signed_on is
  'Date the signed confidentiality agreement came back (Prospect Checklist, migration 040). Null = none on file.';

update project_contacts pc
   set ca_signed_on = v.signed, ca_note = coalesce(pc.ca_note, v.note)
  from (values
    ('CON-2740', date '2026-10-28', 'AM LLC — Signed CAs/Image_261028_173024.jpeg (+ photos 10/29); broker box blank'),
    ('CON-2730', date '2026-10-26', 'Parkson''s LLC — Signed CAs/CA - Parkson''s LLC - EXE - 10.26.26.pdf; broker box blank'),
    ('CON-2750', date '2026-11-04', 'KW Commercial — broker block only; buyer not named (Signed CAs/3167 Joliet Ave - Confidentiality Agreement (KW Commercial).pdf)'),
    ('CON-2756', date '2026-11-13', 'Signed CAs/2026-11-13 19-38.pdf'),
    ('CON-2757', date '2026-11-16', 'Imperial Inn — Signed CAs/CA - 3167 Joliet - Imperial Inn - Signed 2026-11-16.pdf'),
    ('CON-2764', date '2026-11-12', 'Signed individually (Nokomis FL) — Signed CAs/Saran-3167 Joliet Ave.pdf; broker box blank')
  ) as v(code, signed, note)
  join contacts c on c.display_code = v.code
 where pc.contact_id = c.id
   and pc.project_id = '892b1945-eae4-405d-af02-efe3151d0bb8';

notify pgrst, 'reload schema';
