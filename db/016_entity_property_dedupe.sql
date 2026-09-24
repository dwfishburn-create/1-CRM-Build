-- Dan Fishburn CRM — v1 schema, migration 016
-- Entity and property lookup, aliasing, near-match detection, merge, delete.
--
-- This is the second half of the duplicate-prevention work migration 014
-- started for contacts, and it is the gate on the RealNex import (Dan's call,
-- 9/22/2026: "we definitely need this feature to avoid creating duplicates …
-- extremely important to have in place before you start to do any importing").
--
-- What 014 left undone, found by audit 9/24/2026:
--   * create_contact still had no duplicate check of any kind. Its own tool
--     description said so ("this tool does not check for duplicates"), which
--     makes correct use depend on the caller remembering to run find_contact
--     first — the exact discipline that failed four times in three days and
--     produced CON-0068, CON-0070, CON-0073 and CON-0074.
--   * Entities had no alias list, no near-match check and NO MERGE AT ALL.
--     list_entities' description admitted it: "a duplicate entity has no
--     merge path and becomes permanent." TitleCore, LLC / TitleCore National
--     (9/14/2026) was resolved by human judgment, not by anything the schema
--     could enforce or undo.
--   * Properties had no lookup at all — list_properties took a limit and
--     nothing else — no merge and no delete.
--
-- The import that is waiting on this brings 26,156 contacts (13,642 of them
-- in exact first/last/company duplicate triples), ~2,083 companies and 3,834
-- properties, of which 1,549 carry a parcel number. Dedupe has to be a
-- property of the write path, not of the caller's memory.
--
-- Five parts:
--   1. Normalization functions (entity name, address) + generated columns
--   2. entity_aliases, and entities.search_text rebuilt to include them
--   3. properties.search_text (the missing lookup)
--   4. find_similar_contacts / _entities / _properties — the near-match check
--      the create routes call before every insert
--   5. entity_link_counts / property_link_counts, merge_entities,
--      merge_properties — the undo path, same shape as merge_contacts (014)

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. Normalization
--
-- Why normalize at all: the duplicates that actually occur are not typos, they
-- are the same name written the way a different document wrote it. "Ashley
-- Lynn's Inc." and "Ashley Lynns, Inc" are the same company; so are "TitleCore,
-- LLC" and "TitleCore National". Trigram similarity alone scores the first pair
-- high and the second pair mediocre, because the legal suffix is a large share
-- of a short string. Stripping punctuation and entity suffixes first makes both
-- pairs obvious.
--
-- Both functions are immutable (lower/regexp_replace/btrim only), which is what
-- a generated column requires.
-- ---------------------------------------------------------------------------
create or replace function normalize_entity_name(p_name text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        -- Apostrophes are DELETED, not turned into spaces: "Ashley Lynn's"
        -- and "Ashley Lynns" have to normalize to the same string, and
        -- replacing the apostrophe with a space yields "ashley lynn s",
        -- which scores 0.69 against "ashley lynns" — under any sane block
        -- threshold. (Measured, 9/24/2026, against a real Postgres.)
        replace(lower(coalesce(p_name, '')), '''', ''),
        '[^a-z0-9 ]', ' ', 'g'),
      '\y(llc|l l c|inc|incorporated|corp|corporation|company|co|ltd|limited|lp|llp|plc|pc|trust|the|of|and)\y',
      ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

-- Address normalization: case, punctuation, directionals and the common
-- street-type words. "3606 South 61st Avenue Circle" and "3606 S 61st Ave Cir"
-- are the same building; RealNex holds both spellings for the same property in
-- different modules.
--
-- Directionals are KEPT, collapsed to their abbreviation, because they
-- distinguish real addresses — 100 N 72nd and 100 S 72nd are two different
-- buildings, and removing the directional would manufacture a false match.
-- They are folded one at a time because a single regexp_replace cannot map
-- eight long forms onto eight different short ones.
--
-- Street-type words are removed in both spellings, since that is the part that
-- actually varies. This is safe against ordinals: \yst\y does not match inside
-- "61st", because a word boundary requires a non-word character and digits are
-- word characters. Verified against Postgres 16, 9/24/2026.
create or replace function normalize_address(p_address text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(lower(coalesce(p_address, '')), '[^a-z0-9 ]', ' ', 'g'),
                      '\ynortheast\y', 'ne', 'g'),
                    '\ynorthwest\y', 'nw', 'g'),
                  '\ysoutheast\y', 'se', 'g'),
                '\ysouthwest\y', 'sw', 'g'),
              '\ynorth\y', 'n', 'g'),
            '\ysouth\y', 's', 'g'),
          '\yeast\y', 'e', 'g'),
        '\ywest\y', 'w', 'g'),
      '\y(street|st|avenue|ave|av|road|rd|drive|dr|boulevard|blvd|circle|cir|court|ct|lane|ln|place|pl|parkway|pkwy|highway|hwy|terrace|ter|square|sq|plaza|plz|suite|ste|unit|apartment|apt)\y',
      ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

alter table entities
  add column if not exists name_normalized text generated always as (
    normalize_entity_name(name)
  ) stored;

create index if not exists idx_entities_name_normalized
  on entities (name_normalized);

create index if not exists idx_entities_name_normalized_trgm
  on entities using gin (name_normalized gin_trgm_ops);

alter table properties
  add column if not exists address_normalized text generated always as (
    normalize_address(address)
  ) stored;

create index if not exists idx_properties_address_normalized_trgm
  on properties using gin (address_normalized gin_trgm_ops);

-- Parcel number is the other half of property identity, and the one Dan asked
-- for by name on 9/22/2026: 1,549 of the 3,834 RealNex properties carry one,
-- and a parcel match catches duplicates that address matching misses (same
-- parcel, two different street spellings) as well as tying a row to assessor
-- research. Normalized because APNs are written with and without dashes.
create index if not exists idx_properties_parcel_normalized
  on properties (regexp_replace(lower(coalesce(parcel_number, '')), '[^a-z0-9]', '', 'g'))
  where parcel_number is not null;

-- ---------------------------------------------------------------------------
-- 2. entity_aliases
--
-- One entity, many names: the legal name, the d/b/a, the name on the lease,
-- the name the assessor has, the name a broker used in an email. trade_name
-- (added 9/8/2026) holds exactly one of those, which is why it could not do
-- this job — flagged as open question #3 on 9/14/2026.
--
-- source records where an alias came from, because "the assessor spells it
-- this way" and "someone typed it this way once" deserve different trust.
-- Aliases created by a merge are stamped 'merge' automatically.
-- ---------------------------------------------------------------------------
create table if not exists entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  alias text not null,
  source text, -- 'merge' | 'assessor' | 'lease' | 'secretary of state' | free text
  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_entity_aliases_unique
  on entity_aliases (entity_id, lower(alias));

create index if not exists idx_entity_aliases_entity on entity_aliases (entity_id);

create index if not exists idx_entity_aliases_normalized
  on entity_aliases (normalize_entity_name(alias));

alter table entity_aliases enable row level security;

-- alias_text is a plain column kept in sync by trigger, not a generated one:
-- a generated column cannot read another table. It exists so that entities'
-- existing search_text — one ilike per token, the pattern every list endpoint
-- uses — covers aliases too, without the API layer learning to join.
alter table entities
  add column if not exists alias_text text;

create or replace function sync_entity_alias_text()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_entity_id uuid;
begin
  v_entity_id := coalesce(new.entity_id, old.entity_id);

  update entities
     set alias_text = (
           select string_agg(lower(a.alias), ' ' order by a.alias)
             from entity_aliases a
            where a.entity_id = v_entity_id
         )
   where id = v_entity_id;

  -- An UPDATE that moved an alias between entities has to refresh both.
  if tg_op = 'UPDATE' and new.entity_id is distinct from old.entity_id then
    update entities
       set alias_text = (
             select string_agg(lower(a.alias), ' ' order by a.alias)
               from entity_aliases a
              where a.entity_id = old.entity_id
           )
     where id = old.entity_id;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_entity_aliases_sync on entity_aliases;
create trigger trg_entity_aliases_sync
  after insert or update or delete on entity_aliases
  for each row execute function sync_entity_alias_text();

-- Rebuild entities.search_text to include alias_text. A generated column's
-- expression cannot be altered in place, so it is dropped and recreated; the
-- trigram index on it goes with it and is recreated too. No data is lost —
-- every value is derived.
drop index if exists idx_entities_search_text_trgm;
alter table entities drop column if exists search_text;
alter table entities
  add column search_text text generated always as (
    lower(
      coalesce(name, '') || ' ' ||
      coalesce(trade_name, '') || ' ' ||
      coalesce(industry, '') || ' ' ||
      coalesce(alias_text, '')
    )
  ) stored;

create index idx_entities_search_text_trgm
  on entities using gin (search_text gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3. properties.search_text — the lookup properties never had
--
-- Same generated-column pattern as contacts and entities in 014, for the same
-- reason: PostgREST's or() cannot express "these tokens, ANDed, across these
-- columns", and a property is identified by a combination of fields (street
-- number, street, suite, city, parcel) rather than by any one of them.
-- ---------------------------------------------------------------------------
alter table properties
  add column if not exists search_text text generated always as (
    lower(
      coalesce(address, '') || ' ' ||
      coalesce(suite_number, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(state, '') || ' ' ||
      coalesce(zip, '') || ' ' ||
      coalesce(parcel_number, '') || ' ' ||
      coalesce(submarket, '')
    )
  ) stored;

create index if not exists idx_properties_search_text_trgm
  on properties using gin (search_text gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 4. Near-match detection
--
-- Each function returns a jsonb array of candidates, most similar first, with
-- a score in [0,1] and a human-readable reason. The create routes call these
-- before every insert and refuse the write when anything scores at or above
-- the block threshold, returning the candidates so the caller can link to an
-- existing row instead. See lib/nearMatch.ts.
--
-- Scores are conventional, not statistical: 1.0 exact identity (same email,
-- same normalized name, same parcel), 0.9 containment or alias hit, and
-- anything else is raw trigram similarity. The route layer decides what to do
-- with them; this layer only measures.
-- ---------------------------------------------------------------------------
create or replace function find_similar_contacts(
  p_first text,
  p_last text,
  p_email text,
  p_limit integer default 5
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with target as (
    select btrim(lower(coalesce(p_first, ''))) as first_n,
           btrim(lower(coalesce(p_last, '')))  as last_n,
           btrim(lower(coalesce(p_email, ''))) as email_n
  ),
  scored as (
    select c.id,
           c.display_code,
           btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as name,
           c.email,
           c.entity_id,
           case
             when t.email_n <> '' and lower(btrim(coalesce(c.email, ''))) = t.email_n then 1.0
             when t.last_n <> '' and lower(coalesce(c.last_name, '')) = t.last_n
                  and t.first_n <> '' and lower(coalesce(c.first_name, '')) = t.first_n then 1.0
             when t.last_n <> '' and lower(coalesce(c.last_name, '')) = t.last_n
                  and t.first_n <> ''
                  and left(lower(coalesce(c.first_name, '')), 1) = left(t.first_n, 1) then 0.9
             else similarity(
                    lower(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
                    btrim(t.first_n || ' ' || t.last_n))
           end::numeric as score,
           case
             when t.email_n <> '' and lower(btrim(coalesce(c.email, ''))) = t.email_n
               then 'same email address'
             when t.last_n <> '' and lower(coalesce(c.last_name, '')) = t.last_n
                  and t.first_n <> '' and lower(coalesce(c.first_name, '')) = t.first_n
               then 'same first and last name'
             when t.last_n <> '' and lower(coalesce(c.last_name, '')) = t.last_n
                  and t.first_n <> ''
                  and left(lower(coalesce(c.first_name, '')), 1) = left(t.first_n, 1)
               then 'same last name, same first initial (Mitch / Mitchell)'
             else 'similar name'
           end as reason
      from contacts c, target t
     where t.first_n <> '' or t.last_n <> '' or t.email_n <> ''
  )
  select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.score desc), '[]'::jsonb)
    from (select * from scored where score >= 0.4 order by score desc limit greatest(p_limit, 1)) s;
$$;

create or replace function find_similar_entities(
  p_name text,
  p_limit integer default 5
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with target as (
    select normalize_entity_name(p_name) as norm,
           btrim(lower(coalesce(p_name, ''))) as raw
  ),
  scored as (
    select e.id,
           e.display_code,
           e.name,
           e.trade_name,
           e.entity_type,
           case
             when t.norm <> '' and e.name_normalized = t.norm then 1.0
             when t.norm <> '' and exists (
                    select 1 from entity_aliases a
                     where a.entity_id = e.id
                       and normalize_entity_name(a.alias) = t.norm) then 0.95
             when t.norm <> '' and e.name_normalized <> ''
                  and (e.name_normalized like '%' || t.norm || '%'
                       or t.norm like '%' || e.name_normalized || '%') then 0.9
             else similarity(e.name_normalized, t.norm)
           end::numeric as score,
           case
             when t.norm <> '' and e.name_normalized = t.norm
               then 'same name once punctuation and LLC/Inc are removed'
             when t.norm <> '' and exists (
                    select 1 from entity_aliases a
                     where a.entity_id = e.id
                       and normalize_entity_name(a.alias) = t.norm)
               then 'matches a known alias of this entity'
             when t.norm <> '' and e.name_normalized <> ''
                  and (e.name_normalized like '%' || t.norm || '%'
                       or t.norm like '%' || e.name_normalized || '%')
               then 'one name contains the other (TitleCore / TitleCore National)'
             else 'similar name'
           end as reason
      from entities e, target t
     where t.norm <> ''
  )
  select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.score desc), '[]'::jsonb)
    from (select * from scored where score >= 0.4 order by score desc limit greatest(p_limit, 1)) s;
$$;

create or replace function find_similar_properties(
  p_address text,
  p_city text default null,
  p_parcel text default null,
  p_limit integer default 5
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with target as (
    select normalize_address(p_address) as norm,
           btrim(lower(coalesce(p_city, ''))) as city_n,
           regexp_replace(lower(coalesce(p_parcel, '')), '[^a-z0-9]', '', 'g') as parcel_n
  ),
  scored as (
    select p.id,
           p.display_code,
           p.address,
           p.suite_number,
           p.city,
           p.parcel_number,
           case
             when t.parcel_n <> ''
                  and regexp_replace(lower(coalesce(p.parcel_number, '')), '[^a-z0-9]', '', 'g') = t.parcel_n
               then 1.0
             when t.norm <> '' and p.address_normalized = t.norm
                  and (t.city_n = '' or lower(coalesce(p.city, '')) = t.city_n) then 1.0
             when t.norm <> '' and p.address_normalized = t.norm then 0.9
             else similarity(p.address_normalized, t.norm)
           end::numeric as score,
           case
             when t.parcel_n <> ''
                  and regexp_replace(lower(coalesce(p.parcel_number, '')), '[^a-z0-9]', '', 'g') = t.parcel_n
               then 'same parcel number'
             when t.norm <> '' and p.address_normalized = t.norm
                  and (t.city_n = '' or lower(coalesce(p.city, '')) = t.city_n)
               then 'same address'
             when t.norm <> '' and p.address_normalized = t.norm
               then 'same street address, different city on file'
             else 'similar address'
           end as reason
      from properties p, target t
     where t.norm <> '' or t.parcel_n <> ''
  )
  select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.score desc), '[]'::jsonb)
    from (select * from scored where score >= 0.45 order by score desc limit greatest(p_limit, 1)) s;
$$;

-- ---------------------------------------------------------------------------
-- 5a. Link counts — what points at an entity / a property
--
-- Same purpose as contact_link_counts (014): one round trip, and an honest
-- answer before anything is destroyed.
--
-- sole_party_blocks, for entities, is the same class of problem contacts have:
-- leases and property_tenant each require at least one of (entity, contact)
-- and their entity FKs are ON DELETE SET NULL, so deleting the only party on
-- such a row nulls the column and then fails the check constraint.
--
-- For properties the danger is different and larger: spaces.property_id is NOT
-- NULL ON DELETE CASCADE, and leases.space_id is NOT NULL ON DELETE CASCADE
-- under that. Deleting a property therefore deletes its spaces AND every lease
-- on them — the lease history the whole critical-dates design depends on —
-- with no warning from Postgres at all. cascade_destroys names that explicitly.
-- ---------------------------------------------------------------------------
create or replace function entity_link_counts(p_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'property_owner',      (select count(*) from property_owner     where entity_id = p_id),
    'property_tenant',     (select count(*) from property_tenant    where entity_id = p_id),
    'contacts',            (select count(*) from contacts           where entity_id = p_id),
    'contact_entities',    (select count(*) from contact_entities   where entity_id = p_id),
    'project_contacts',    (select count(*) from project_contacts   where entity_id = p_id),
    'requirement_parties', (select count(*) from requirement_parties where entity_id = p_id),
    'reference_links',     (select count(*) from reference_links    where entity_id = p_id),
    'activity_log',        (select count(*) from activity_log       where entity_id = p_id),
    'tasks',               (select count(*) from tasks              where entity_id = p_id),
    'leases_tenant',       (select count(*) from leases             where tenant_entity_id = p_id),
    'leases_landlord',     (select count(*) from leases             where landlord_entity_id = p_id),
    'owner_signals',       (select count(*) from owner_signals      where entity_id = p_id),
    'aliases',             (select count(*) from entity_aliases     where entity_id = p_id),
    'sole_party_blocks', jsonb_build_object(
      'leases_tenant_only',
        (select count(*) from leases
          where tenant_entity_id = p_id and tenant_contact_id is null),
      'property_tenant_only',
        (select count(*) from property_tenant
          where entity_id = p_id and contact_id is null)
    )
  );
$$;

create or replace function property_link_counts(p_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'spaces',             (select count(*) from spaces            where property_id = p_id),
    'property_owner',     (select count(*) from property_owner    where property_id = p_id),
    'property_tenant',    (select count(*) from property_tenant   where property_id = p_id),
    'project_properties', (select count(*) from project_properties where property_id = p_id),
    'property_expenses',  (select count(*) from property_expenses where property_id = p_id),
    'owner_signals',      (select count(*) from owner_signals     where property_id = p_id),
    'reference_links',    (select count(*) from reference_links   where property_id = p_id),
    'activity_log',       (select count(*) from activity_log      where property_id = p_id),
    'tasks',              (select count(*) from tasks             where property_id = p_id),
    'sale_comps',         (select count(*) from sale_comps        where property_id = p_id),
    'lease_comps',        (select count(*) from lease_comps       where property_id = p_id),
    'child_properties',   (select count(*) from properties        where parent_property_id = p_id),
    'cascade_destroys', jsonb_build_object(
      'spaces',
        (select count(*) from spaces where property_id = p_id),
      'leases_under_those_spaces',
        (select count(*) from leases l
          join spaces s on s.id = l.space_id
         where s.property_id = p_id),
      'lease_events_under_those_leases',
        (select count(*) from lease_events e
          join leases l on l.id = e.lease_id
          join spaces s on s.id = l.space_id
         where s.property_id = p_id)
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 5b. merge_entities
--
-- Same contract as merge_contacts (014): one transaction, every reference
-- repointed onto the survivor, the survivor wins every populated scalar field,
-- the loser only fills blanks, notes are appended with a provenance line.
--
-- The complete set of references to entities(id), as of migration 015:
--   property_owner.entity_id        (002, cascade)
--   property_tenant.entity_id       (002, set null)
--   contacts.entity_id              (002, set null)
--   activity_log.entity_id          (002, set null)
--   tasks.entity_id                 (002, set null)
--   requirement_parties.entity_id   (004, cascade)
--   reference_links.entity_id       (006, set null)
--   project_contacts.entity_id      (008, cascade, unique idx w/ project_id)
--   contact_entities.entity_id      (009, cascade, unique w/ contact_id)
--   leases.tenant_entity_id         (011, set null)
--   leases.landlord_entity_id       (011, set null)
--   owner_signals.entity_id         (015, set null)
--   entity_aliases.entity_id        (016, cascade)
-- A future migration adding a fourteenth must add it here too, or a merge
-- silently drops that link through ON DELETE SET NULL/CASCADE.
--
-- One thing merge_contacts does not do: the loser's name, trade name and
-- aliases are kept, as aliases on the survivor. That is the whole point of
-- merging TitleCore National into TitleCore, LLC — the name that was merged
-- away is exactly the name the next document will use, so it has to stay
-- searchable.
-- ---------------------------------------------------------------------------
create or replace function merge_entities(p_keep_id uuid, p_merge_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_keep  entities%rowtype;
  v_merge entities%rowtype;
  v_moved jsonb := '{}'::jsonb;
  v_n     integer;
begin
  if p_keep_id is null or p_merge_id is null then
    raise exception 'Both keep_id and merge_id are required.';
  end if;

  if p_keep_id = p_merge_id then
    raise exception 'keep_id and merge_id are the same entity (%).', p_keep_id;
  end if;

  select * into v_keep from entities where id = p_keep_id;
  if not found then
    raise exception 'keep_id % does not exist in entities.', p_keep_id;
  end if;

  select * into v_merge from entities where id = p_merge_id;
  if not found then
    raise exception 'merge_id % does not exist in entities.', p_merge_id;
  end if;

  -- Keep the loser's names as aliases on the survivor, before anything is
  -- deleted. 'merge' as the source so provenance is visible later.
  insert into entity_aliases (entity_id, alias, source, note)
  select p_keep_id, v_merge.name, 'merge',
         'name of ' || coalesce(v_merge.display_code, p_merge_id::text) || ', merged ' || current_date
  where coalesce(btrim(v_merge.name), '') <> ''
  on conflict do nothing;

  insert into entity_aliases (entity_id, alias, source, note)
  select p_keep_id, v_merge.trade_name, 'merge',
         'trade name of ' || coalesce(v_merge.display_code, p_merge_id::text) || ', merged ' || current_date
  where coalesce(btrim(v_merge.trade_name), '') <> ''
  on conflict do nothing;

  -- Move the loser's own aliases across, skipping any the survivor already has.
  delete from entity_aliases l
   where l.entity_id = p_merge_id
     and exists (
       select 1 from entity_aliases k
        where k.entity_id = p_keep_id
          and lower(k.alias) = lower(l.alias)
     );
  update entity_aliases set entity_id = p_keep_id where entity_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('entity_aliases', v_n);

  -- property_owner — no unique constraint, but the same entity owning the same
  -- property over the same period twice is a duplicate, not history.
  delete from property_owner l
   where l.entity_id = p_merge_id
     and exists (
       select 1 from property_owner k
        where k.entity_id = p_keep_id
          and k.property_id = l.property_id
          and k.ownership_start_date is not distinct from l.ownership_start_date
     );
  update property_owner set entity_id = p_keep_id where entity_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('property_owner', v_n);

  -- property_tenant — same reasoning, keyed on the lease start date
  delete from property_tenant l
   where l.entity_id = p_merge_id
     and exists (
       select 1 from property_tenant k
        where k.entity_id = p_keep_id
          and k.property_id = l.property_id
          and k.lease_start_date is not distinct from l.lease_start_date
     );
  update property_tenant set entity_id = p_keep_id where entity_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('property_tenant', v_n);

  -- contact_entities — unique (contact_id, entity_id)
  delete from contact_entities l
   where l.entity_id = p_merge_id
     and exists (
       select 1 from contact_entities k
        where k.entity_id = p_keep_id
          and k.contact_id = l.contact_id
     );
  update contact_entities set entity_id = p_keep_id where entity_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('contact_entities', v_n);

  -- project_contacts — unique index (project_id, entity_id)
  delete from project_contacts l
   where l.entity_id = p_merge_id
     and exists (
       select 1 from project_contacts k
        where k.entity_id = p_keep_id
          and k.project_id = l.project_id
     );
  update project_contacts set entity_id = p_keep_id where entity_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('project_contacts', v_n);

  -- requirement_parties — no unique constraint; dedupe on the pair the row
  -- would become
  delete from requirement_parties l
   where l.entity_id = p_merge_id
     and exists (
       select 1 from requirement_parties k
        where k.entity_id = p_keep_id
          and k.requirement_id = l.requirement_id
          and k.contact_id is not distinct from l.contact_id
     );
  update requirement_parties set entity_id = p_keep_id where entity_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('requirement_parties', v_n);

  -- plain repoints
  update contacts set entity_id = p_keep_id where entity_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('contacts', v_n);

  update reference_links set entity_id = p_keep_id where entity_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('reference_links', v_n);

  update activity_log set entity_id = p_keep_id where entity_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('activity_log', v_n);

  update tasks set entity_id = p_keep_id where entity_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('tasks', v_n);

  update leases set tenant_entity_id = p_keep_id where tenant_entity_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('leases_tenant', v_n);

  update leases set landlord_entity_id = p_keep_id where landlord_entity_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('leases_landlord', v_n);

  update owner_signals set entity_id = p_keep_id where entity_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('owner_signals', v_n);

  -- Scalar backfill onto the survivor.
  update entities set
    trade_name         = coalesce(v_keep.trade_name,         v_merge.trade_name),
    entity_type        = coalesce(v_keep.entity_type,        v_merge.entity_type),
    industry           = coalesce(v_keep.industry,           v_merge.industry),
    website            = coalesce(v_keep.website,            v_merge.website),
    primary_contact_id = coalesce(v_keep.primary_contact_id, v_merge.primary_contact_id),
    notes = case
      when v_merge.notes is null or btrim(v_merge.notes) = '' then v_keep.notes
      when v_keep.notes  is null or btrim(v_keep.notes)  = '' then v_merge.notes
      else v_keep.notes || E'\n\n[merged from '
           || coalesce(v_merge.display_code, p_merge_id::text) || '] ' || v_merge.notes
    end,
    updated_at = now()
  where id = p_keep_id;

  delete from entities where id = p_merge_id;

  return jsonb_build_object(
    'merged', true,
    'kept',    jsonb_build_object('id', p_keep_id,  'display_code', v_keep.display_code,  'name', v_keep.name),
    'removed', jsonb_build_object('id', p_merge_id, 'display_code', v_merge.display_code, 'name', v_merge.name),
    'rows_repointed', v_moved,
    'alias_kept', v_merge.name
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5c. merge_properties
--
-- References to properties(id), as of migration 015:
--   property_owner.property_id      (001, cascade)
--   activity_log.property_id        (001, set null)
--   tasks.property_id               (001, set null)
--   sale_comps.property_id          (001, set null)
--   lease_comps.property_id         (001, set null)
--   properties.parent_property_id   (002, set null — self-reference)
--   property_tenant.property_id     (002, cascade)
--   project_properties.property_id  (003, cascade, unique w/ project_id)
--   reference_links.property_id     (006, cascade)
--   spaces.property_id              (011, cascade)
--   property_expenses.property_id   (012, cascade)
--   owner_signals.property_id       (015, cascade)
-- (projects.property_id existed in 001 and was dropped by 003 when
-- project_properties replaced it with a many-to-many — confirmed against a
-- from-scratch rebuild of 001-016, 9/24/2026.)
--
-- The self-reference needs care in both directions: the loser's children move
-- to the survivor, and if the loser was the survivor's own parent the survivor
-- inherits the loser's parent instead, so no row ends up its own ancestor.
-- ---------------------------------------------------------------------------
create or replace function merge_properties(p_keep_id uuid, p_merge_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_keep  properties%rowtype;
  v_merge properties%rowtype;
  v_moved jsonb := '{}'::jsonb;
  v_n     integer;
begin
  if p_keep_id is null or p_merge_id is null then
    raise exception 'Both keep_id and merge_id are required.';
  end if;

  if p_keep_id = p_merge_id then
    raise exception 'keep_id and merge_id are the same property (%).', p_keep_id;
  end if;

  select * into v_keep from properties where id = p_keep_id;
  if not found then
    raise exception 'keep_id % does not exist in properties.', p_keep_id;
  end if;

  select * into v_merge from properties where id = p_merge_id;
  if not found then
    raise exception 'merge_id % does not exist in properties.', p_merge_id;
  end if;

  -- Self-reference, survivor side: if the loser was the survivor's parent, the
  -- survivor takes the loser's parent (usually null) rather than pointing at a
  -- row that is about to be deleted.
  if v_keep.parent_property_id = p_merge_id then
    update properties
       set parent_property_id = case
             when v_merge.parent_property_id = p_keep_id then null
             else v_merge.parent_property_id
           end
     where id = p_keep_id;
  end if;

  -- Self-reference, children side.
  update properties set parent_property_id = p_keep_id
   where parent_property_id = p_merge_id and id <> p_keep_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('child_properties', v_n);

  -- project_properties — unique (project_id, property_id)
  delete from project_properties l
   where l.property_id = p_merge_id
     and exists (
       select 1 from project_properties k
        where k.property_id = p_keep_id
          and k.project_id = l.project_id
     );
  update project_properties set property_id = p_keep_id where property_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('project_properties', v_n);

  -- property_owner — dedupe on (entity, ownership start)
  delete from property_owner l
   where l.property_id = p_merge_id
     and exists (
       select 1 from property_owner k
        where k.property_id = p_keep_id
          and k.entity_id = l.entity_id
          and k.ownership_start_date is not distinct from l.ownership_start_date
     );
  update property_owner set property_id = p_keep_id where property_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('property_owner', v_n);

  -- property_tenant — dedupe on (entity, contact, lease start)
  delete from property_tenant l
   where l.property_id = p_merge_id
     and exists (
       select 1 from property_tenant k
        where k.property_id = p_keep_id
          and k.entity_id is not distinct from l.entity_id
          and k.contact_id is not distinct from l.contact_id
          and k.lease_start_date is not distinct from l.lease_start_date
     );
  update property_tenant set property_id = p_keep_id where property_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('property_tenant', v_n);

  -- plain repoints. spaces moves rather than cascading, which is the whole
  -- reason merge exists for properties: a deleted duplicate takes its spaces,
  -- leases and lease events with it.
  update spaces set property_id = p_keep_id where property_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('spaces', v_n);

  update property_expenses set property_id = p_keep_id where property_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('property_expenses', v_n);

  update owner_signals set property_id = p_keep_id where property_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('owner_signals', v_n);

  update reference_links set property_id = p_keep_id where property_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('reference_links', v_n);

  update activity_log set property_id = p_keep_id where property_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('activity_log', v_n);

  update tasks set property_id = p_keep_id where property_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('tasks', v_n);

  update sale_comps set property_id = p_keep_id where property_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('sale_comps', v_n);

  update lease_comps set property_id = p_keep_id where property_id = p_merge_id;
  get diagnostics v_n = row_count;
  v_moved := v_moved || jsonb_build_object('lease_comps', v_n);

  -- Scalar backfill onto the survivor. address stays the survivor's; every
  -- other field the survivor lacks is taken from the loser, which is how a
  -- duplicate created from a lease (with a parcel number) improves the record
  -- created from a drive-by (without one).
  update properties set
    city              = coalesce(v_keep.city,              v_merge.city),
    state             = coalesce(v_keep.state,             v_merge.state),
    zip               = coalesce(v_keep.zip,               v_merge.zip),
    county            = coalesce(v_keep.county,            v_merge.county),
    parcel_number     = coalesce(v_keep.parcel_number,     v_merge.parcel_number),
    property_type     = coalesce(v_keep.property_type,     v_merge.property_type),
    submarket         = coalesce(v_keep.submarket,         v_merge.submarket),
    building_sf       = coalesce(v_keep.building_sf,       v_merge.building_sf),
    land_acres        = coalesce(v_keep.land_acres,        v_merge.land_acres),
    year_built        = coalesce(v_keep.year_built,        v_merge.year_built),
    suite_number      = coalesce(v_keep.suite_number,      v_merge.suite_number),
    latitude          = coalesce(v_keep.latitude,          v_merge.latitude),
    longitude         = coalesce(v_keep.longitude,         v_merge.longitude),
    priority          = coalesce(v_keep.priority,          v_merge.priority),
    notes = case
      when v_merge.notes is null or btrim(v_merge.notes) = '' then v_keep.notes
      when v_keep.notes  is null or btrim(v_keep.notes)  = '' then v_merge.notes
      else v_keep.notes || E'\n\n[merged from '
           || coalesce(v_merge.display_code, p_merge_id::text) || ' — '
           || coalesce(v_merge.address, '') || '] ' || v_merge.notes
    end,
    updated_at = now()
  where id = p_keep_id;

  delete from properties where id = p_merge_id;

  return jsonb_build_object(
    'merged', true,
    'kept',    jsonb_build_object('id', p_keep_id,  'display_code', v_keep.display_code,  'address', v_keep.address),
    'removed', jsonb_build_object('id', p_merge_id, 'display_code', v_merge.display_code, 'address', v_merge.address),
    'rows_repointed', v_moved
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: seed entity_aliases from the trade names already on file, so the
-- alias search works on day one rather than only for entities touched after
-- this migration. trade_name stays where it is — this adds a searchable copy,
-- it does not move anything.
-- ---------------------------------------------------------------------------
insert into entity_aliases (entity_id, alias, source, note)
select e.id, e.trade_name, 'trade_name', 'seeded from entities.trade_name by migration 016'
  from entities e
 where coalesce(btrim(e.trade_name), '') <> ''
on conflict do nothing;
