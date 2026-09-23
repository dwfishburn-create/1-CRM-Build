-- Dan Fishburn CRM — v1 schema, migration 014
-- Contact lookup, contact merge/delete, and a verification flag.
--
-- Closes findings #1, #2 and #4 from CRM_Findings_2026-09-15_BR-HyVee.md,
-- all three of which surfaced running the BR-Hy-Vee 108th & Hwy 370 title
-- commitment through the CRM on 9/14-15/2026:
--
--   #1  list_contacts had no lookup and no server-side filter, so the only
--       way to answer "does this person already exist?" was to dump all 64
--       rows (57,000 chars on 9/14, ~63,000 on 9/15 — both over the tool
--       response cap) to a file and grep it.
--   #2  There was no delete and no merge, so when CON-0068 turned out to be
--       a duplicate of Daniel E. Moore (CON-0058), the correction could only
--       be cosmetic: a permanent tombstone row renamed "[MERGED] see ...".
--   #4  "Unverified" lived only as prose inside the notes field, so guessed
--       records were indistinguishable from confirmed ones in any query.
--
-- Findings #1 and #2 compound — no lookup creates duplicates, no merge makes
-- them permanent — which is why they ship together here.
--
-- Three parts, in dependency order:
--   1. search_text generated columns + trigram indexes (the lookup)
--   2. needs_verification / verification_note on contacts (the flag)
--   3. merge_contacts() and contact_link_counts() functions (the merge)

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. Lookup — search_text generated columns
--
-- Why a generated column rather than an .or() across first_name/last_name/
-- email at the API layer: PostgREST's `or` filter is a flat list of
-- per-column conditions, so "Richard Secor" as a single ilike pattern
-- matches no individual column (it spans two), and splitting it into tokens
-- gives an OR of tokens, which matches every Richard and every Secor rather
-- than the one person. Concatenating the searchable fields into one stored
-- column makes the natural query a plain ilike, and multi-token search
-- becomes one chained ilike per token — which PostgREST ANDs together, the
-- semantics actually wanted.
--
-- Stored (not virtual) so it can carry a GIN trigram index; lower() and ||
-- over coalesce() are immutable, which is what generated-always requires.
-- ---------------------------------------------------------------------------
alter table contacts
  add column if not exists search_text text generated always as (
    lower(
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '') || ' ' ||
      coalesce(email, '') || ' ' ||
      coalesce(title, '')
    )
  ) stored;

create index if not exists idx_contacts_search_text_trgm
  on contacts using gin (search_text gin_trgm_ops);

-- Entities are on the same curve (54 rows at time of writing, same response
-- cap, same absence of a lookup), so they get the same treatment. trade_name
-- is included because it is where d/b/a names live (Hibbett Sports, Dollar
-- Tree on the Lexington rent roll) and is often what a search actually knows.
alter table entities
  add column if not exists search_text text generated always as (
    lower(
      coalesce(name, '') || ' ' ||
      coalesce(trade_name, '') || ' ' ||
      coalesce(industry, '')
    )
  ) stored;

create index if not exists idx_entities_search_text_trgm
  on entities using gin (search_text gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 2. Verification flag (finding #4)
--
-- needs_verification is the queryable half; verification_note says what
-- specifically is unconfirmed ("last name inferred from email handle",
-- "person behind danocox860@cox.net not yet identified"). Partial index
-- because the interesting query is always "show me the unverified ones" —
-- the false rows are the overwhelming majority and never scanned by name.
-- ---------------------------------------------------------------------------
alter table contacts
  add column if not exists needs_verification boolean not null default false,
  add column if not exists verification_note text;

create index if not exists idx_contacts_needs_verification
  on contacts (needs_verification) where needs_verification;

-- ---------------------------------------------------------------------------
-- 3a. contact_link_counts — what points at a contact
--
-- Backs the delete guard: one round trip instead of ten count queries from
-- the route handler. Also the honest answer to "is this row actually safe to
-- remove?" before anything is destroyed.
--
-- sole_party_blocks is a separate, harder class. leases and property_tenant
-- both carry a check constraint requiring at least one of (entity, contact).
-- Their contact FKs are ON DELETE SET NULL, so deleting a contact who is the
-- ONLY party on such a row makes Postgres set the column null and then fail
-- the check — a confusing constraint-violation error at the end of a delete
-- that already looked like it was going to work. Better to detect it up front
-- and say so.
-- ---------------------------------------------------------------------------
create or replace function contact_link_counts(p_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'project_contacts',         (select count(*) from project_contacts   where contact_id = p_id),
    'contact_entities',         (select count(*) from contact_entities   where contact_id = p_id),
    'requirement_parties',      (select count(*) from requirement_parties where contact_id = p_id),
    'activity_log',             (select count(*) from activity_log       where contact_id = p_id),
    'tasks',                    (select count(*) from tasks              where contact_id = p_id),
    'tasks_waiting_on',         (select count(*) from tasks              where waiting_on_contact_id = p_id),
    'entities_primary_contact', (select count(*) from entities           where primary_contact_id = p_id),
    'property_tenant',          (select count(*) from property_tenant    where contact_id = p_id),
    'leases_tenant',            (select count(*) from leases             where tenant_contact_id = p_id),
    'leases_landlord',          (select count(*) from leases             where landlord_contact_id = p_id),
    'sole_party_blocks', jsonb_build_object(
      'leases_tenant_only',
        (select count(*) from leases
          where tenant_contact_id = p_id and tenant_entity_id is null),
      'property_tenant_only',
        (select count(*) from property_tenant
          where contact_id = p_id and entity_id is null)
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 3b. merge_contacts — repoint every reference, then remove the duplicate
--
-- A plpgsql function rather than a sequence of supabase-js calls from the
-- route handler, for one reason: atomicity. There are ten FK columns
-- pointing at contacts across nine tables. Ten separate HTTP round trips
-- that half-succeed leave a contact partly merged, which is strictly worse
-- than the tombstone workaround this replaces. Inside a function it is one
-- transaction: all of it lands or none of it does.
--
-- The complete set of references to contacts(id), as of migration 013:
--   project_contacts.contact_id        (006, cascade, unique w/ project_id)
--   contact_entities.contact_id        (009, cascade, unique w/ entity_id)
--   requirement_parties.contact_id     (004, cascade, no unique constraint)
--   activity_log.contact_id            (001, set null)
--   tasks.contact_id                   (001, set null)
--   tasks.waiting_on_contact_id        (005, set null)
--   entities.primary_contact_id        (002, set null)
--   property_tenant.contact_id         (002, set null)
--   leases.tenant_contact_id           (011, set null)
--   leases.landlord_contact_id         (011, set null)
-- If a future migration adds an eleventh, it must be added here too, or a
-- merge will silently drop that link via ON DELETE SET NULL/CASCADE.
--
-- Join tables with a unique constraint need the loser's row deleted first
-- where the keeper already has the equivalent row — otherwise the UPDATE
-- collides with the constraint. The keeper's row wins in that case; its
-- role/notes are not overwritten by the loser's.
--
-- Scalar fields: the keeper wins every populated field. The loser only fills
-- blanks. Notes are the exception — they are appended with a provenance line
-- rather than discarded, because a duplicate's notes are usually the reason
-- it existed (this is exactly the CON-0068 case: its note recorded where the
-- unidentified address came from).
-- ---------------------------------------------------------------------------
create or replace function merge_contacts(p_keep_id uuid, p_merge_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_keep    contacts%rowtype;
  v_merge   contacts%rowtype;
  v_moved   jsonb := '{}'::jsonb;
  v_n       integer;
begin
  if p_keep_id is null or p_merge_id is null then
    raise exception 'Both keep_id and merge_id are required.';
  end if;

  if p_keep_id = p_merge_id then
    raise exception 'keep_id and merge_id are the same contact (%).', p_keep_id;
  end if;

  select * into v_keep from contacts where id = p_keep_id;
  if not found then
    raise exception 'keep_id % does not exist in contacts.', p_keep_id;
  end if;

  select * into v_merge from contacts where id = p_merge_id;
  if not found then
    raise exception 'merge_id % does not exist in contacts.', p_merge_id;
  end if;

  -- project_contacts — unique (project_id, contact_id)
  delete from project_contacts l
   where l.contact_id = p_merge_id
     and exists (
       select 1 from project_contacts k
        where k.contact_id = p_keep_id
          and k.project_id = l.project_id
     );
  update project_contacts set contact_id = p_keep_id where contact_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('project_contacts', v_n);

  -- contact_entities — unique (contact_id, entity_id)
  delete from contact_entities l
   where l.contact_id = p_merge_id
     and exists (
       select 1 from contact_entities k
        where k.contact_id = p_keep_id
          and k.entity_id = l.entity_id
     );
  update contact_entities set contact_id = p_keep_id where contact_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('contact_entities', v_n);

  -- requirement_parties — no unique constraint, so dedupe by hand on the
  -- (requirement, entity) pair the row would become
  delete from requirement_parties l
   where l.contact_id = p_merge_id
     and exists (
       select 1 from requirement_parties k
        where k.contact_id = p_keep_id
          and k.requirement_id = l.requirement_id
          and k.entity_id is not distinct from l.entity_id
     );
  update requirement_parties set contact_id = p_keep_id where contact_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('requirement_parties', v_n);

  -- plain repoints — no unique constraints on any of these
  update activity_log set contact_id = p_keep_id where contact_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('activity_log', v_n);

  update tasks set contact_id = p_keep_id where contact_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('tasks', v_n);

  update tasks set waiting_on_contact_id = p_keep_id where waiting_on_contact_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('tasks_waiting_on', v_n);

  update entities set primary_contact_id = p_keep_id where primary_contact_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('entities_primary_contact', v_n);

  update property_tenant set contact_id = p_keep_id where contact_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('property_tenant', v_n);

  update leases set tenant_contact_id = p_keep_id where tenant_contact_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('leases_tenant', v_n);

  update leases set landlord_contact_id = p_keep_id where landlord_contact_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('leases_landlord', v_n);

  -- Scalar backfill onto the keeper. v_keep was read before any of the
  -- statements above, none of which touch contacts, so it is still current.
  update contacts set
    first_name   = coalesce(v_keep.first_name,   v_merge.first_name),
    last_name    = coalesce(v_keep.last_name,    v_merge.last_name),
    email        = coalesce(v_keep.email,        v_merge.email),
    phone        = coalesce(v_keep.phone,        v_merge.phone),
    mobile_phone = coalesce(v_keep.mobile_phone, v_merge.mobile_phone),
    title        = coalesce(v_keep.title,        v_merge.title),
    entity_id    = coalesce(v_keep.entity_id,    v_merge.entity_id),
    notes = case
      when v_merge.notes is null or btrim(v_merge.notes) = '' then v_keep.notes
      when v_keep.notes  is null or btrim(v_keep.notes)  = '' then v_merge.notes
      else v_keep.notes || E'\n\n[merged from '
           || coalesce(v_merge.display_code, p_merge_id::text) || '] ' || v_merge.notes
    end,
    updated_at = now()
  where id = p_keep_id;

  delete from contacts where id = p_merge_id;

  return jsonb_build_object(
    'merged', true,
    'kept', jsonb_build_object(
      'id', p_keep_id,
      'display_code', v_keep.display_code,
      'name', btrim(coalesce(v_keep.first_name, '') || ' ' || coalesce(v_keep.last_name, ''))
    ),
    'removed', jsonb_build_object(
      'id', p_merge_id,
      'display_code', v_merge.display_code,
      'name', btrim(coalesce(v_merge.first_name, '') || ' ' || coalesce(v_merge.last_name, ''))
    ),
    'rows_repointed', v_moved
  );
end;
$$;
