-- Dan Fishburn CRM — migration 041
-- Prospect Checklist: Buyer Package Sent and Offer Made markers (11/18/2026,
-- Dan: "I want an Icon added for the following: Buyer Package Sent. Offer
-- Made. And a way to sort the list based on those things. CA Delivered,
-- Buyer Package Sent. Offer Made.").
--
-- Same shape as the signed-CA marker (migration 040), plus a yes/no flag,
-- because several Joliet prospects got the package in June and the date
-- was never recorded — the flag says "sent", the date is filled in when known.
--
--   package_sent / package_sent_on / package_note — purple "Pkg" tag
--     (purple = documents sent, the same as Dan's deal timelines)
--   offer_made / offer_made_on / offer_note — coral "Offer" tag
--     (coral = closing/target milestones). offer_made_on = the LATEST offer;
--     offer_note carries the terms and any earlier offers.
--
-- A trigger keeps the flags honest: setting a date sets its flag; turning a
-- flag off clears its date and note.
--
-- Backfill:
--   1. Every deal: stage package_sent / touring / offer / under_contract →
--      package_sent; stage offer / under_contract → offer_made (no dates).
--   2. CS-3167 Joliet Ave: dates and notes from the activity log (11/18/2026),
--      and #47 Ankita Patel's stage moves to Offer ($500K cash, 11/16).
--
-- Run in the Supabase SQL editor (Run without RLS), then:
--   notify pgrst, 'reload schema';

alter table project_contacts
  add column if not exists package_sent boolean not null default false,
  add column if not exists package_sent_on date,
  add column if not exists package_note text,
  add column if not exists offer_made boolean not null default false,
  add column if not exists offer_made_on date,
  add column if not exists offer_note text;

comment on column project_contacts.package_sent is
  'Buyer package sent to this prospect (Prospect Checklist, migration 041). package_sent_on when the date is known.';
comment on column project_contacts.offer_made is
  'Prospect has made an offer (Prospect Checklist, migration 041). offer_made_on = latest offer; offer_note = terms / earlier offers.';

create or replace function project_contacts_milestone_flags() returns trigger
language plpgsql as $$
begin
  -- Turning a flag off (true -> false) wins: it clears the date and note.
  if tg_op = 'UPDATE' and old.package_sent and not new.package_sent then
    new.package_sent_on := null; new.package_note := null;
  elsif new.package_sent_on is not null then
    new.package_sent := true;
  end if;
  if tg_op = 'UPDATE' and old.offer_made and not new.offer_made then
    new.offer_made_on := null; new.offer_note := null;
  elsif new.offer_made_on is not null then
    new.offer_made := true;
  end if;
  return new;
end $$;

drop trigger if exists project_contacts_milestone_flags on project_contacts;
create trigger project_contacts_milestone_flags
  before insert or update of package_sent, package_sent_on, package_note, offer_made, offer_made_on, offer_note
  on project_contacts
  for each row execute function project_contacts_milestone_flags();

-- 1. Flags from stage, every deal.
update project_contacts set package_sent = true
 where prospect_stage in ('package_sent', 'touring', 'offer', 'under_contract') and not package_sent;
update project_contacts set offer_made = true
 where prospect_stage in ('offer', 'under_contract') and not offer_made;

-- 2. CS-3167 Joliet Ave dates (from the activity log).
update project_contacts pc
   set package_sent = true,
       package_sent_on = v.pkg,
       package_note = coalesce(pc.package_note, v.pkg_note)
  from (values
    ('CON-2740', date '2026-10-29', 'Buyer package by email 10/29 (LOG-0341); updated financials link 11/4'),
    ('CON-2730', date '2026-10-28', 'Financials & Property Package by email 10/28 (LOG-0328)'),
    ('CON-2750', date '2026-11-04', 'Buyer Package link 11/4 (to the broker; buyer not named)'),
    ('CON-2764', date '2026-11-13', 'DD package Dropbox link 11/13; photos not in the folder at send time'),
    ('CON-2756', date '2026-11-14', 'Buyer Package 11/14'),
    ('CON-2757', date '2026-11-16', 'Buyer Package Dropbox link 11/16; 2026 YTD revenue still owed')
  ) as v(code, pkg, pkg_note)
  join contacts c on c.display_code = v.code
 where pc.contact_id = c.id
   and pc.project_id = '892b1945-eae4-405d-af02-efe3151d0bb8';

update project_contacts pc
   set offer_made = true,
       offer_made_on = v.offer,
       offer_note = coalesce(pc.offer_note, v.offer_note)
  from (values
    ('CON-2740', date '2026-11-13', '$700K cash, 2-week close, no franchise (revised 11/13). Earlier: $800K 10/29; seller countered $1.2M 11/4'),
    ('CON-2756', date '2026-11-16', '$500K cash, 30-day close, $50K EM if required; called it her final offer (email, not an LOI)')
  ) as v(code, offer, offer_note)
  join contacts c on c.display_code = v.code
 where pc.contact_id = c.id
   and pc.project_id = '892b1945-eae4-405d-af02-efe3151d0bb8';

update project_contacts pc
   set prospect_stage = 'offer'
  from contacts c
 where c.display_code = 'CON-2756'
   and pc.contact_id = c.id
   and pc.project_id = '892b1945-eae4-405d-af02-efe3151d0bb8'
   and pc.prospect_stage = 'package_sent';

notify pgrst, 'reload schema';

-- Check:
--   select prospect_no, prospect_stage, ca_signed_on, package_sent, package_sent_on, offer_made, offer_made_on
--     from project_contacts where project_id = '892b1945-eae4-405d-af02-efe3151d0bb8'
--      and (package_sent or offer_made) order by prospect_no;
