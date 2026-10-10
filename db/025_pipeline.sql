-- Dan Fishburn CRM — v1 schema, migration 025
-- Pipeline (Build #2), built together with Tier B #3, #4 and #5.
--
-- Decisions this implements (decisions log):
--   9/22/2026  Tier B #3 Result (Active / Inactive / Won / Lost / Dropped),
--              separate from status so a win rate is computable.
--              Tier B #4 client vs. counterparty side on every project party.
--              Tier B #5 commission participants as a sub-table.
--              Commission tracker: expected → invoiced → received; unpaid
--              commission ages on the Dashboard as Waiting On.
--   9/26/2026  Store gross AND Dan's share; show Dan's share. Share = after
--              deal-level splits, before CBRE's internal payout. Fee basis
--              varies by deal. Splits asked per deal, no default.
--   10/6/2026  Share, splits, probability and expected close are collected in
--              the app the first time each active deal is opened, not on the
--              markup sheet. Executed deals are receivables, not pipeline.
--
-- Parts:
--   1. projects: result, fee basis, Dan's share %, setup flag; deal_value and
--      expected_value regenerated (a flat fee is the basis amount itself);
--      dan_share_value and expected_share_value added
--   2. Result follows status (closed_won → won, closed_lost → lost)
--   3. project_contacts.party_side (Tier B #4)
--   4. project_commission_participants (Tier B #5), seeded from any existing
--      project_contacts.split_pct values
--   5. commission_payments (receivables)
--   6. One-time load of what the 10/4 markup sheet already held — blank
--      fields only, never overwriting a value already in the CRM
--
-- Expected close is the existing projects.target_close_date. Basis amount is
-- the existing projects.deal_price. Nothing is renamed, so every route, page
-- and MCP tool that reads them keeps working.
--
-- Run with "Run without RLS" (contains PL/pgSQL), then reload the schema.

begin;

-- ---------------------------------------------------------------------------
-- 1. projects
-- ---------------------------------------------------------------------------
alter table projects
  add column if not exists result text not null default 'active',
  add column if not exists result_date date,
  add column if not exists result_note text,
  add column if not exists fee_basis text,
  add column if not exists dan_share_pct numeric,
  add column if not exists pipeline_setup_at timestamptz;

alter table projects drop constraint if exists projects_result_check;
alter table projects add constraint projects_result_check
  check (result in ('active', 'inactive', 'won', 'lost', 'dropped'));

alter table projects drop constraint if exists projects_fee_basis_check;
alter table projects add constraint projects_fee_basis_check
  check (fee_basis is null or fee_basis in
    ('sale_price', 'base_rent_term', 'sublease_consideration', 'savings_buyout', 'flat_fee', 'other'));

alter table projects drop constraint if exists projects_dan_share_pct_check;
alter table projects add constraint projects_dan_share_pct_check
  check (dan_share_pct is null or (dan_share_pct >= 0 and dan_share_pct <= 100));

-- Backfill Result from status. on_hold reads as Inactive.
update projects set result = case status
    when 'closed_won'  then 'won'
    when 'closed_lost' then 'lost'
    when 'on_hold'     then 'inactive'
    else 'active' end
 where result = 'active';

-- Regenerate the value columns. A generated column can't reference another
-- generated column, so each expression is written out in full.
--   deal_value            gross fee: basis × rate, or the basis itself for a flat fee
--   expected_value        gross × probability (kept — the Dashboard sorts on it)
--   dan_share_value       gross × Dan's share
--   expected_share_value  gross × Dan's share × probability — the pipeline number
alter table projects drop column if exists expected_value;
alter table projects drop column if exists deal_value;
alter table projects drop column if exists dan_share_value;
alter table projects drop column if exists expected_share_value;

alter table projects
  add column deal_value numeric generated always as (
    case when fee_basis = 'flat_fee' then deal_price
         else deal_price * commission_rate / 100 end
  ) stored,
  add column expected_value numeric generated always as (
    case when fee_basis = 'flat_fee' then deal_price
         else deal_price * commission_rate / 100 end
    * probability_pct / 100
  ) stored,
  add column dan_share_value numeric generated always as (
    case when fee_basis = 'flat_fee' then deal_price
         else deal_price * commission_rate / 100 end
    * dan_share_pct / 100
  ) stored,
  add column expected_share_value numeric generated always as (
    case when fee_basis = 'flat_fee' then deal_price
         else deal_price * commission_rate / 100 end
    * dan_share_pct / 100 * probability_pct / 100
  ) stored;

create index if not exists idx_projects_result on projects(result);

-- ---------------------------------------------------------------------------
-- 2. Result follows status when a deal is closed
-- ---------------------------------------------------------------------------
-- Only moves an Active result, and only on the transition, so a Result Dan
-- set by hand (e.g. Won before status catches up) is never overwritten.
create or replace function projects_result_from_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status and new.result = 'active' then
    if new.status = 'closed_won' then
      new.result := 'won';
      new.result_date := coalesce(new.result_date, current_date);
    elsif new.status = 'closed_lost' then
      new.result := 'lost';
      new.result_date := coalesce(new.result_date, current_date);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_result_from_status on projects;
create trigger trg_projects_result_from_status
  before update of status on projects
  for each row execute function projects_result_from_status();

-- ---------------------------------------------------------------------------
-- 3. project_contacts.party_side (Tier B #4)
-- ---------------------------------------------------------------------------
alter table project_contacts
  add column if not exists party_side text;
alter table project_contacts drop constraint if exists project_contacts_party_side_check;
alter table project_contacts add constraint project_contacts_party_side_check
  check (party_side is null or party_side in ('client', 'counterparty', 'other'));

-- ---------------------------------------------------------------------------
-- 4. project_commission_participants (Tier B #5)
-- ---------------------------------------------------------------------------
-- Everyone besides Dan who shares the fee. A party can be a contact, a
-- company, or just a name when it isn't on file yet.
create table if not exists project_commission_participants (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  entity_id uuid references entities(id) on delete set null,
  party_name text,
  role text not null default 'other',
  split_pct numeric,
  off_the_top boolean not null default false,
  notes text,
  source_system text,
  source_record_id text,
  source_batch_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pcp_party_present check (
    contact_id is not null or entity_id is not null or nullif(btrim(party_name), '') is not null),
  constraint pcp_role_check check (
    role in ('colleague', 'co_broker', 'referral', 'outside_broker', 'other')),
  constraint pcp_split_check check (split_pct is null or (split_pct >= 0 and split_pct <= 100))
);

create index if not exists idx_pcp_project on project_commission_participants(project_id);
alter table project_commission_participants enable row level security;

-- Carry over any split already recorded on project_contacts (migration 008),
-- once — skipped for a project that already has participants.
insert into project_commission_participants
  (project_id, contact_id, entity_id, role, split_pct, notes, source_system)
select pc.project_id, pc.contact_id, pc.entity_id,
       case
         when pc.role ilike '%referr%'                  then 'referral'
         when pc.role ilike '%co-broker%'
           or pc.role ilike '%cooperating%'
           or pc.role ilike '%co broker%'               then 'co_broker'
         when pc.role ilike '%outside%'                 then 'outside_broker'
         when pc.role ilike '%colleague%'
           or pc.role ilike '%cbre%'                    then 'colleague'
         else 'other' end,
       pc.split_pct,
       nullif(concat_ws(' — ', nullif(pc.role, ''), 'carried over from project_contacts.split_pct by migration 025'), ''),
       'migration-025'
  from project_contacts pc
 where pc.split_pct is not null
   and not exists (select 1 from project_commission_participants x where x.project_id = pc.project_id);

-- ---------------------------------------------------------------------------
-- 5. commission_payments (receivables)
-- ---------------------------------------------------------------------------
-- One row per expected payment. Amount is GROSS; Dan's share of it is
-- amount × projects.dan_share_pct, computed where it's shown. A payment is
-- owed once earned_date has passed and received_date is empty — that is
-- what ages on the Dashboard.
create table if not exists commission_payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label text not null,
  amount numeric,
  earned_date date,
  due_note text,
  invoiced_date date,
  received_date date,
  received_amount numeric,
  notes text,
  source_system text,
  source_record_id text,
  source_batch_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_commission_payments_project on commission_payments(project_id);
create index if not exists idx_commission_payments_unpaid
  on commission_payments(earned_date) where received_date is null;
alter table commission_payments enable row level security;

-- ---------------------------------------------------------------------------
-- 6. One-time load from CRM_Pipeline_Markup_2026-10-04.xlsx
-- ---------------------------------------------------------------------------
-- Only what the sheet already held (fee basis, basis amount, rate) plus
-- Dan's 10/4 calls. coalesce() everywhere: a value already in the CRM wins.
-- Dan's share, splits, probability and expected close are NOT loaded — the
-- app asks for them the first time each active deal is opened (10/6/2026).
update projects set
  fee_basis       = coalesce(fee_basis, v.basis),
  deal_price      = coalesce(deal_price, v.amount),
  commission_rate = coalesce(commission_rate, v.rate)
from (values
  -- Dan 10/4: carry the sale track at the $925K offer; lapsed listing → probability
  ('CL-2305 Krenzien Dr',                           'sale_price',             925000::numeric, 6::numeric),
  ('CS-3167 Joliet Ave',                            'sale_price',             2000000,         6),
  ('CS-2802 Plum Creek Pky - Shoppes of Lexington', 'sale_price',             null,            6),
  ('L-11010 Blondo St',                             'sale_price',             1475000,         3),
  ('CL-4930 L St',                                  'base_rent_term',         null,            6),
  ('CL-3606 S 61st Ave Cir',                        'base_rent_term',         null,            6),
  ('SL-W2W-5040 N 27th',                            'sublease_consideration', null,            6),
  ('SL-W2W-12977 W Center Rd',                      'sublease_consideration', null,            6),
  ('BR-Hy-Vee 108th & Hwy 370',                     'sale_price',             15019000,        2),
  ('TR-Team Clase Codigo LLC',                      'base_rent_term',         2205000,         3.452381),
  ('TR-JC Hobby',                                   'base_rent_term',         445319.69,       3),
  ('LRT-Palm Beach Tan-16819QSt',                   'base_rent_term',         230850,          1.5),
  -- Dan 10/4: full remaining obligation until an LA and a rent are set
  ('SL-5585 N 90th St',                             'sublease_consideration', 3297277.5,       6)
  -- SL-United Healthcare Norfolk NE: left blank (Dan 10/4 — track unknown until Jake Scott shares the Lincoln info)
) as v(code, basis, amount, rate)
where projects.project_code = v.code;

-- Team Clase Codigo: executed 9/4/2026 — a receivable, not pipeline.
-- Dan's share 25% was approved 9/28/2026 and is already in the project notes.
update projects set
  result        = 'won',
  result_date   = coalesce(result_date, date '2026-09-04'),
  dan_share_pct = coalesce(dan_share_pct, 25)
 where project_code = 'TR-Team Clase Codigo LLC'
   and result = 'active';

insert into commission_payments (project_id, label, amount, earned_date, due_note, notes, source_system)
select p.id, x.label, x.amount, x.earned, x.due_note, x.notes, 'markup-2026-10-04'
  from projects p
  cross join (values
    ('Payment 1', 47250::numeric, date '2026-09-04', null::text,
     '4.5% of base rent, lease years 1–5. Earned at execution 9/4/2026.'),
    ('Payment 2', 28875::numeric, null::date, 'Lease Year 6',
     '2.5% of base rent, lease years 6–10. Due in Lease Year 6.')
  ) as x(label, amount, earned, due_note, notes)
 where p.project_code = 'TR-Team Clase Codigo LLC'
   and not exists (select 1 from commission_payments c where c.project_id = p.id);

commit;

notify pgrst, 'reload schema';

-- VERIFICATION — run after the block above. Expected: the four object checks
-- true; active_deals = number of active deals; gross_total ≈ 734,789 (the
-- 10/4 sheet's $810,914 less Team Clase Codigo, now a receivable — unless a
-- value was changed in the CRM since 10/4); clase_result = won;
-- clase_payments = 2; clase_owed_share = 11812.50.
select
  exists (select 1 from information_schema.columns where table_name = 'projects' and column_name = 'expected_share_value') as share_cols,
  exists (select 1 from information_schema.tables  where table_name = 'project_commission_participants')                as participants,
  exists (select 1 from information_schema.tables  where table_name = 'commission_payments')                            as payments,
  exists (select 1 from information_schema.columns where table_name = 'project_contacts' and column_name = 'party_side') as party_side,
  (select count(*) from projects where status = 'active' and result = 'active')                                         as active_deals,
  (select round(sum(deal_value)) from projects where status = 'active' and result = 'active')                           as gross_total,
  (select result from projects where project_code = 'TR-Team Clase Codigo LLC')                                         as clase_result,
  (select count(*) from commission_payments c join projects p on p.id = c.project_id
    where p.project_code = 'TR-Team Clase Codigo LLC')                                                                  as clase_payments,
  (select round(c.amount * p.dan_share_pct / 100, 2) from commission_payments c join projects p on p.id = c.project_id
    where p.project_code = 'TR-Team Clase Codigo LLC' and c.label = 'Payment 1')                                       as clase_owed_share;
