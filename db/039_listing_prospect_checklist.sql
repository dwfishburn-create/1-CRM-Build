-- Dan Fishburn CRM — migration 039
-- Listing Prospect Checklist (11/18/2026, handoff from the 3167 Joliet Ave project).
--
-- A per-listing page, /projects/[id]/prospects, listing every buyer prospect on
-- a sale listing so follow-up calls are worked from the CRM instead of a
-- spreadsheet. First listing: CS-3167 Joliet Ave (ABVI hotel, Missouri Valley IA),
-- replacing ABVI_Repricing_Send_Checklist.xlsx (54 prospects).
--
-- A "prospect" is a project_contacts row with party_side = 'counterparty' and a
-- role containing "prospect" or "buyer" — no new link table; the 38 prospects
-- that were only on the spreadsheet were loaded as contacts + links on 11/18
-- (batch abvi-checklist-2026-11-18) before this migration.
--
-- 1. project_contacts gains the checklist fields:
--      prospect_no        stable per-project number. Dan reports calls by it
--                         ("#19 talked, wants tour"), so it is assigned once and
--                         never renumbered. New prospects get max + 1 (trigger).
--      first_contact_date defaults to the day the prospect is linked.
--      prospect_source    constrained list (Tier B #7).
--      prospect_stage     constrained list (Tier B #7), Cold → Under contract / Passed.
--      company_note       the company/property as given, shown when no entity
--                         is linked ("Super 8 Missouri Valley").
-- 2. project_campaigns + project_campaign_recipients: a dated send to the
--    prospect list (e.g. the 11/13 "$1.2M repricing email") and, per prospect,
--    whether they got it. These are the checklist's campaign flag columns.
-- 3. Backfill: CS-3167 Joliet Ave numbers, dates, sources, stages and the
--    repricing campaign, from the spreadsheet; every other project's existing
--    prospects numbered by first contact.
--
-- Run in the Supabase SQL editor (Run without RLS), then:
--   notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 1. Checklist fields on project_contacts
-- ---------------------------------------------------------------------------
alter table project_contacts
  add column if not exists prospect_no integer,
  add column if not exists first_contact_date date,
  add column if not exists prospect_source text,
  add column if not exists prospect_stage text,
  add column if not exists company_note text;

alter table project_contacts drop constraint if exists project_contacts_prospect_source_check;
alter table project_contacts add constraint project_contacts_prospect_source_check
  check (prospect_source is null or prospect_source in (
    'loopnet', 'crexi', 'costar', 'prospect_sheet', 'inbound_email', 'inbound_call',
    'sign_call', 'broker', 'referral', 'other'));

alter table project_contacts drop constraint if exists project_contacts_prospect_stage_check;
alter table project_contacts add constraint project_contacts_prospect_stage_check
  check (prospect_stage is null or prospect_stage in (
    'cold', 'contacted', 'brochure_sent', 'ca_pending', 'ca_signed', 'package_sent',
    'touring', 'offer', 'under_contract', 'on_hold', 'passed'));

create unique index if not exists project_contacts_prospect_no_uniq
  on project_contacts (project_id, prospect_no) where prospect_no is not null;

comment on column project_contacts.prospect_no is
  'Stable per-project buyer-prospect number (Prospect Checklist, migration 039). Assigned once, never renumbered.';

create or replace function is_buyer_prospect(p_side text, p_role text)
returns boolean language sql immutable as $$
  select coalesce(p_side, '') = 'counterparty'
     and (coalesce(p_role, '') ilike '%prospect%' or coalesce(p_role, '') ilike '%buyer%');
$$;

-- New prospects get the next number and today's date (Central) as first contact.
create or replace function project_contacts_assign_prospect_no()
returns trigger language plpgsql as $$
begin
  if is_buyer_prospect(new.party_side, new.role) then
    if new.first_contact_date is null then
      new.first_contact_date := (now() at time zone 'America/Chicago')::date;
    end if;
    if new.prospect_no is null then
      perform pg_advisory_xact_lock(hashtext('prospect_no:' || new.project_id::text));
      select coalesce(max(prospect_no), 0) + 1 into new.prospect_no
        from project_contacts where project_id = new.project_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_project_contacts_prospect_no on project_contacts;
create trigger trg_project_contacts_prospect_no
  before insert or update of party_side, role on project_contacts
  for each row execute function project_contacts_assign_prospect_no();

-- ---------------------------------------------------------------------------
-- 2. Campaigns
-- ---------------------------------------------------------------------------
create table if not exists project_campaigns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  sent_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);
create index if not exists idx_project_campaigns_project on project_campaigns(project_id);
alter table project_campaigns enable row level security;

create table if not exists project_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references project_campaigns(id) on delete cascade,
  project_contact_id uuid not null references project_contacts(id) on delete cascade,
  status text not null check (status in ('sent', 'told_other', 'not_sent', 'bounced')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, project_contact_id)
);
create index if not exists idx_campaign_recipients_pc on project_campaign_recipients(project_contact_id);
alter table project_campaign_recipients enable row level security;

-- ---------------------------------------------------------------------------
-- 3a. Backfill — CS-3167 Joliet Ave, from ABVI_Repricing_Send_Checklist.xlsx
-- ---------------------------------------------------------------------------
create temp table _joliet (no int, code text, first_contact date, source text, stage text,
                           company text, campaign_status text, campaign_note text);
insert into _joliet values
  (1, 'CON-2781', date '2026-04-20', 'prospect_sheet', 'package_sent', 'Dual Stop', 'sent', 'Sent 11/13; texted 11/18'),
  (2, 'CON-2769', date '2026-04-23', 'prospect_sheet', 'passed', 'Kwik Trip (RE Development Mgr)', 'sent', 'Sent 11/13 (land angle + BK parcel); replied no interest 11/13'),
  (3, 'CON-2780', date '2026-04-27', 'prospect_sheet', 'package_sent', 'Sunflower Motel', 'told_other', 'Told by call/text 11/18 (email bounced)'),
  (4, 'CON-2782', date '2026-04-27', 'prospect_sheet', 'cold', 'Lincoln Hotel Group (Dir. of Ops)', 'not_sent', 'No email'),
  (5, 'CON-2783', date '2026-04-27', 'prospect_sheet', 'package_sent', 'Solaris Hospitality', 'sent', null),
  (6, 'CON-2792', date '2026-04-27', 'prospect_sheet', 'passed', 'Patriot Hospitality', 'not_sent', 'No email'),
  (7, 'CON-2784', date '2026-04-27', 'prospect_sheet', 'cold', 'Krivera LLC', 'not_sent', 'No email'),
  (8, 'CON-2793', date '2026-04-27', 'prospect_sheet', 'passed', 'Saphire Properties LLC', 'not_sent', 'No email'),
  (9, 'CON-2785', date '2026-04-27', 'prospect_sheet', 'cold', 'Kinseth Hospitality Companies', 'not_sent', 'No email'),
  (10, 'CON-2786', date '2026-04-27', 'prospect_sheet', 'cold', 'Starwood Property Trust', 'not_sent', 'No email'),
  (11, 'CON-2787', date '2026-04-27', 'prospect_sheet', 'passed', 'Diwan FF Nebraska LLC', 'not_sent', 'No email'),
  (12, 'CON-2788', date '2026-04-27', 'prospect_sheet', 'passed', 'Keenan Management LLC', 'not_sent', 'No email'),
  (13, 'CON-2789', date '2026-04-27', 'prospect_sheet', 'on_hold', 'Avadh LLC', 'not_sent', 'No email'),
  (14, 'CON-2794', date '2026-04-27', 'prospect_sheet', 'cold', null, 'not_sent', 'No email'),
  (15, 'CON-2790', date '2026-04-27', 'prospect_sheet', 'cold', null, 'not_sent', 'No email'),
  (16, 'CON-2791', date '2026-04-27', 'prospect_sheet', 'on_hold', null, 'sent', null),
  (17, 'CON-2795', date '2026-04-27', 'prospect_sheet', 'passed', null, 'not_sent', 'No email'),
  (18, 'CON-2796', date '2026-04-28', 'prospect_sheet', 'package_sent', null, 'sent', null),
  (19, 'CON-2797', date '2026-04-28', 'prospect_sheet', 'package_sent', null, 'sent', null),
  (20, 'CON-2798', date '2026-04-28', 'prospect_sheet', 'package_sent', null, 'sent', null),
  (21, 'CON-2799', date '2026-04-28', 'prospect_sheet', 'passed', null, 'not_sent', 'No email'),
  (22, 'CON-2800', date '2026-04-28', 'prospect_sheet', 'cold', null, 'not_sent', 'No email'),
  (23, 'CON-2801', date '2026-04-28', 'prospect_sheet', 'cold', 'Kaeding Development (Minneapolis)', 'not_sent', 'No email'),
  (24, 'CON-2802', date '2026-04-28', 'prospect_sheet', 'cold', null, 'not_sent', 'No email'),
  (25, 'CON-2803', date '2026-04-28', 'prospect_sheet', 'cold', null, 'not_sent', 'No email'),
  (26, 'CON-2804', date '2026-06-03', 'prospect_sheet', 'package_sent', null, 'not_sent', 'No email'),
  (27, 'CON-2818', date '2026-06-17', 'prospect_sheet', 'brochure_sent', 'omaharealestate.com', 'sent', null),
  (28, 'CON-2805', date '2026-06-17', 'prospect_sheet', 'brochure_sent', 'Nightcap Mgmt (Holiday Inn Express Blair)', 'sent', null),
  (29, 'CON-2806', date '2026-06-17', 'prospect_sheet', 'contacted', 'Alliance1 Hotels (Super 8 Blair)', 'sent', null),
  (30, 'CON-2807', date '2026-06-17', 'prospect_sheet', 'cold', 'Rodeway Inn Blair', 'not_sent', 'No email'),
  (31, 'CON-2808', date '2026-06-22', 'prospect_sheet', 'cold', 'Super 8 Missouri Valley', 'not_sent', 'No email'),
  (32, 'CON-2809', date '2026-06-22', 'prospect_sheet', 'cold', 'Travelodge Missouri Valley owner', 'not_sent', 'No email'),
  (33, 'CON-2810', date '2026-06-22', 'prospect_sheet', 'cold', 'Tekamah Motel', 'not_sent', 'No email'),
  (34, 'CON-2811', date '2026-06-22', 'prospect_sheet', 'contacted', 'Sunflower Hospitality (Western Inn CB)', 'sent', null),
  (35, 'CON-2812', date '2026-06-23', 'prospect_sheet', 'contacted', 'Deluxe Inn Council Bluffs', 'sent', null),
  (36, 'CON-2813', date '2026-06-23', 'prospect_sheet', 'contacted', 'Investment Resources (WoodSpring Suites CB)', 'sent', null),
  (37, 'CON-2814', date '2026-06-23', 'prospect_sheet', 'contacted', 'Belford Hospitality (Microtel CB)', 'sent', null),
  (38, 'CON-2815', date '2026-06-23', 'prospect_sheet', 'contacted', 'Super 8 Council Bluffs', 'sent', null),
  (39, 'CON-2816', date '2026-06-23', 'prospect_sheet', 'contacted', 'Results RE Services (American Inn CB)', 'sent', null),
  (40, 'CON-2817', date '2026-06-23', 'prospect_sheet', 'cold', 'Countryside Inn & Suites CB', 'not_sent', 'No email; no outreach logged'),
  (41, 'CON-2740', date '2026-10-24', 'loopnet', 'offer', 'AM LLC (Big Springs NE)', 'not_sent', 'Held back (Dan''s call) — offer in play'),
  (42, 'CON-2729', date '2026-10-25', 'loopnet', 'ca_pending', 'Toronto', 'sent', null),
  (43, 'CON-2730', date '2026-10-26', null, 'package_sent', 'Parkson''s LLC (Rockwall TX)', 'sent', null),
  (44, 'CON-2774', date '2026-10-26', 'crexi', 'ca_pending', 'Quality Inn?', 'told_other', 'Quoted $1.2M in intro'),
  (45, 'CON-2743', date '2026-10-29', null, 'ca_pending', null, 'sent', null),
  (46, 'CON-2750', date '2026-11-02', 'broker', 'package_sent', 'KW Commercial (buyer''s broker)', 'sent', null),
  (47, 'CON-2756', date '2026-11-08', null, 'package_sent', null, 'sent', null),
  (48, 'CON-2757', date '2026-11-09', null, 'package_sent', 'Imperial Inn?', 'sent', null),
  (49, 'CON-2764', date '2026-11-11', null, 'package_sent', 'Individual (Nokomis FL)', 'told_other', 'Quoted $1.2M in intro'),
  (50, 'CON-2765', date '2026-11-11', 'loopnet', 'ca_pending', null, 'sent', null),
  (51, 'CON-2767', date '2026-11-13', 'loopnet', 'ca_pending', 'Carefree Inn (Lebanon)', 'told_other', 'Quoted $1.2M in intro'),
  (52, 'CON-2768', date '2026-11-13', 'loopnet', 'ca_pending', null, 'told_other', 'Quoted $1.2M in intro'),
  (53, 'CON-2773', date '2026-11-16', 'inbound_email', 'ca_pending', null, 'told_other', 'Quoted $1.2M in intro'),
  (54, 'CON-2779', date '2026-11-17', null, 'ca_pending', null, 'told_other', 'Quoted $1.2M in intro');

update project_contacts pc
   set prospect_no = j.no,
       first_contact_date = j.first_contact,
       prospect_source = j.source,
       prospect_stage = j.stage,
       company_note = coalesce(pc.company_note, j.company)
  from _joliet j, contacts c
 where c.display_code = j.code
   and pc.contact_id = c.id
   and pc.project_id = '892b1945-eae4-405d-af02-efe3151d0bb8';

insert into project_campaigns (project_id, name, sent_on, notes)
values ('892b1945-eae4-405d-af02-efe3151d0bb8', '$1.2M repricing email', date '2026-11-13',
        'Price cut $2.0M → $1.2M (real estate only). From the ABVI repricing send checklist.')
on conflict (project_id, name) do nothing;

insert into project_campaign_recipients (campaign_id, project_contact_id, status, note)
select pcm.id, pc.id, j.campaign_status, j.campaign_note
  from _joliet j
  join contacts c on c.display_code = j.code
  join project_contacts pc on pc.contact_id = c.id and pc.project_id = '892b1945-eae4-405d-af02-efe3151d0bb8'
  join project_campaigns pcm on pcm.project_id = pc.project_id and pcm.name = '$1.2M repricing email'
on conflict (campaign_id, project_contact_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3b. Backfill — every other project's existing prospects, numbered by first contact
-- ---------------------------------------------------------------------------
update project_contacts
   set first_contact_date = (created_at at time zone 'America/Chicago')::date
 where first_contact_date is null
   and is_buyer_prospect(party_side, role);

with base as (
  select project_id, coalesce(max(prospect_no), 0) as start_no
    from project_contacts group by project_id
), numbered as (
  select pc.id,
         b.start_no + row_number() over (partition by pc.project_id
                                         order by pc.first_contact_date, pc.created_at, pc.id) as no
    from project_contacts pc join base b using (project_id)
   where pc.prospect_no is null and is_buyer_prospect(pc.party_side, pc.role)
)
update project_contacts pc set prospect_no = n.no from numbered n where pc.id = n.id;

drop table _joliet;

-- Check (should return 54 rows, #1–#54, no gaps):
--   select prospect_no, first_contact_date, prospect_stage from project_contacts
--    where project_id = '892b1945-eae4-405d-af02-efe3151d0bb8' and prospect_no is not null
--    order by prospect_no;

notify pgrst, 'reload schema';
