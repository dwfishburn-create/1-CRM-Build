-- Dan Fishburn CRM — v1 schema, migration 024
-- Global search box in the top menu (approved 10/10/2026).
--
-- The box searches five record types from any page: contacts, companies
-- (entities), properties, deals (projects) and requirements. It reuses the
-- 017 matcher, search_ids_generic(), unchanged. The rule from 017 stands:
-- one matcher, shared by search and the duplicate check, never a second copy
-- in TypeScript.
--
-- What 017 already covered: contacts (name, email, title), entities (name,
-- trade name, aliases, industry) and properties (address, city, zip, parcel,
-- submarket). Three gaps for a global box:
--
--   1. Contacts could not be found by phone. search_text gets phone and
--      mobile_phone, raw, digits-only AND spaced ("402 555 0100"), so "402-555-0100",
--      "(402) 555-0100", "402.555.0100" and "4025550100" all match one row.
--   2. Projects had no search_text at all. Added: project code, type and
--      client name, raw and normalized.
--   3. Requirements had no search_text at all. Added: code, deal type,
--      property type, target location and details, raw and normalized.
--
-- Matching a deal or requirement by the COMPANY attached to it (a company
-- name finds its deals via client_entity_id, and its requirements via
-- requirement_parties) is done in lib/globalSearch.ts from
-- the entity hits — a join, not a second matcher.
--
-- Not built here, on purpose: the "archived" rank for contacts. It is
-- computed (10/6/2026 decision) and lands with the RealNex import; the
-- search ranks it lower then. Nothing to rank today.
--
-- Run with "Run without RLS" (it contains PL/pgSQL), then reload the schema.

begin;

-- ---------------------------------------------------------------------------
-- 1. contacts.search_text — add phone numbers
-- ---------------------------------------------------------------------------
drop index if exists idx_contacts_search_text_trgm;
alter table contacts drop column if exists search_text;
alter table contacts
  add column search_text text generated always as (
    lower(
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '') || ' ' ||
      coalesce(email, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(phone, '') || ' ' ||
      coalesce(mobile_phone, '') || ' ' ||
      regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') || ' ' ||
      regexp_replace(coalesce(mobile_phone, ''), '[^0-9]', '', 'g') || ' ' ||
      normalize_person_name(coalesce(phone, '')) || ' ' ||
      normalize_person_name(coalesce(mobile_phone, '')) || ' ' ||
      normalize_person_name(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
    )
  ) stored;

create index idx_contacts_search_text_trgm
  on contacts using gin (search_text gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 2. projects.search_text
-- ---------------------------------------------------------------------------
alter table projects drop column if exists search_text;
alter table projects
  add column search_text text generated always as (
    lower(
      coalesce(project_code, '') || ' ' ||
      coalesce(project_type, '') || ' ' ||
      coalesce(client_name, '') || ' ' ||
      normalize_entity_name(coalesce(client_name, '')) || ' ' ||
      normalize_entity_name(coalesce(project_code, ''))
    )
  ) stored;

create index if not exists idx_projects_search_text_trgm
  on projects using gin (search_text gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3. requirements.search_text
-- ---------------------------------------------------------------------------
alter table requirements drop column if exists search_text;
alter table requirements
  add column search_text text generated always as (
    lower(
      coalesce(display_code, '') || ' ' ||
      coalesce(deal_type, '') || ' ' ||
      coalesce(property_type, '') || ' ' ||
      coalesce(target_location, '') || ' ' ||
      coalesce(details, '') || ' ' ||
      normalize_entity_name(coalesce(target_location, '')) || ' ' ||
      normalize_entity_name(coalesce(details, ''))
    )
  ) stored;

create index if not exists idx_requirements_search_text_trgm
  on requirements using gin (search_text gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 4. Search functions — thin wrappers over the 017 matcher
-- ---------------------------------------------------------------------------
create or replace function search_project_ids(
  p_q text, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language sql
stable
set search_path = public
as $$
  select search_ids_generic('projects', p_q, 'normalize_entity_name', p_limit, p_offset);
$$;

create or replace function search_requirement_ids(
  p_q text, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language sql
stable
set search_path = public
as $$
  select search_ids_generic('requirements', p_q, 'normalize_entity_name', p_limit, p_offset);
$$;

commit;

notify pgrst, 'reload schema';

-- VERIFICATION — run after the block above. Expected: all five columns true,
-- both functions true, and phone_digits_match = true if any contact has a
-- phone on file (null if none do).
select
  exists (select 1 from information_schema.columns
           where table_name = 'contacts' and column_name = 'search_text')      as contacts_col,
  exists (select 1 from information_schema.columns
           where table_name = 'projects' and column_name = 'search_text')      as projects_col,
  exists (select 1 from information_schema.columns
           where table_name = 'requirements' and column_name = 'search_text')  as requirements_col,
  exists (select 1 from pg_proc where proname = 'search_project_ids')           as project_fn,
  exists (select 1 from pg_proc where proname = 'search_requirement_ids')       as requirement_fn,
  (select (search_contact_ids(regexp_replace(phone, '[^0-9]', '', 'g'), 5) ->> 'count')::int > 0
     from contacts where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') ~ '[0-9]{7}' limit 1)              as phone_digits_match;
