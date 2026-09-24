-- Dan Fishburn CRM — v1 schema, migration 017
-- One normalizer for both matchers: make SEARCH punctuation- and
-- abbreviation-insensitive, the way the duplicate check already is.
--
-- The bug this fixes, found by testing the 016 gate live on 9/24/2026:
--
--   find_entity("buyers realty")   -> count: 0
--   find_entity("buyer's realty")  -> ENT-0058 "Buyer's Realty, Inc."
--
-- Migration 016 shipped two matchers and normalized only one of them. The
-- duplicate check calls find_similar_entities, which compares
-- name_normalized (punctuation and LLC/Inc/Corp/Trust stripped) — that is
-- why create_entity("Buyers Realty") correctly refused with a 409. But the
-- SEARCH path (find_entity, list_entities?search=) chains ilike '%token%'
-- against search_text, which is raw: "buyer's realty, inc.". The token
-- "buyers" is not a substring of that, so the lookup returns nothing.
--
-- Properties have the same defect, asymmetrically, which is worse than
-- failing outright: searching "S 61st Ave" against a row stored as
-- "3606 South 61st Avenue Circle" works by accident (s, 61st and ave are all
-- substrings of the spelled-out form), while "South 61st Avenue" against a
-- row stored as "3606 S 61st Ave Cir" fails on the token "south".
--
-- Why this mattered enough to fix before the import rather than after: the
-- standing instruction is "run find_entity before create_entity", and the
-- tool description promised normalization it did not perform. A session that
-- trusts count: 0 concludes a company is not on file when it is. No data was
-- ever at risk — the create-side 409 still refuses the duplicate — but the
-- contact import leans on that lookup 26,156 times.
--
-- Two parts:
--   1. Normalized text folded into the search_text columns (and a person-name
--      normalizer, so contacts get the same treatment as entities)
--   2. search_entity_ids / search_property_ids / search_contact_ids — the
--      matching moves into SQL, where it can use the same normalizers the
--      duplicate check uses, instead of being approximated at the API layer

-- ---------------------------------------------------------------------------
-- 1. Normalizers and the rebuilt search_text columns
--
-- Contacts had no normalizer at all. People's names carry apostrophes and
-- hyphens for the same reason company names do — O'Brien, D'Agostino,
-- Smith-Jones — so "obrien" failing to find "O'Brien" is the identical bug in
-- a third place. normalize_person_name deliberately strips punctuation only:
-- there are no meaningless suffix words in a person's name to remove, and
-- stripping anything else would collide distinct people.
-- ---------------------------------------------------------------------------
create or replace function normalize_person_name(p_name text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(
    regexp_replace(
      replace(lower(coalesce(p_name, '')), '''', ''),
      '[^a-z0-9]', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

alter table contacts
  add column if not exists name_normalized text generated always as (
    normalize_person_name(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  ) stored;

create index if not exists idx_contacts_name_normalized_trgm
  on contacts using gin (name_normalized gin_trgm_ops);

-- Rebuild the three search_text columns so each carries BOTH spellings: the
-- raw text a person typed and the normalized form. A generated column's
-- expression cannot be altered in place, so each is dropped and recreated
-- along with its trigram index. Nothing is lost — every value is derived.
--
-- Carrying both is what lets a query match from either direction without the
-- API layer having to guess which spelling the caller used.
drop index if exists idx_contacts_search_text_trgm;
alter table contacts drop column if exists search_text;
alter table contacts
  add column search_text text generated always as (
    lower(
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '') || ' ' ||
      coalesce(email, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      normalize_person_name(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
    )
  ) stored;

create index idx_contacts_search_text_trgm
  on contacts using gin (search_text gin_trgm_ops);

drop index if exists idx_entities_search_text_trgm;
alter table entities drop column if exists search_text;
alter table entities
  add column search_text text generated always as (
    lower(
      coalesce(name, '') || ' ' ||
      coalesce(trade_name, '') || ' ' ||
      coalesce(industry, '') || ' ' ||
      coalesce(alias_text, '') || ' ' ||
      normalize_entity_name(name) || ' ' ||
      normalize_entity_name(coalesce(trade_name, '')) || ' ' ||
      normalize_entity_name(coalesce(alias_text, ''))
    )
  ) stored;

create index idx_entities_search_text_trgm
  on entities using gin (search_text gin_trgm_ops);

drop index if exists idx_properties_search_text_trgm;
alter table properties drop column if exists search_text;
alter table properties
  add column search_text text generated always as (
    lower(
      coalesce(address, '') || ' ' ||
      coalesce(suite_number, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(state, '') || ' ' ||
      coalesce(zip, '') || ' ' ||
      coalesce(parcel_number, '') || ' ' ||
      coalesce(submarket, '') || ' ' ||
      normalize_address(address) || ' ' ||
      regexp_replace(lower(coalesce(parcel_number, '')), '[^a-z0-9]', '', 'g')
    )
  ) stored;

create index idx_properties_search_text_trgm
  on properties using gin (search_text gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 2. The search functions
--
-- Matching moves out of the API layer and into SQL. The reason is the one
-- lib/agentApiClient.ts already states for its own design: logic that exists
-- in two places drifts. Re-implementing normalize_entity_name and
-- normalize_address in TypeScript would have put the search half a step
-- behind the duplicate-check half at the first edit — which is precisely the
-- bug being fixed here, in a new form.
--
-- Per-token semantics: every token in the query must match (AND, as before),
-- but a token matches if EITHER its raw form OR its normalized form is found.
-- That is what makes it work in both directions:
--
--   query "south"  -> raw "south" (no hit on "3606 S 61st Ave Cir")
--                     normalized "s" (hits, at a word boundary)
--   query "s"      -> raw "s" hits the same row directly
--   query "buyers" -> raw miss on "buyer's realty, inc."
--                     normalized "buyers" hits the normalized half
--
-- The normalized alternative is matched at a word start (' ' || token) rather
-- than as a bare substring. Without that, a token like "south" normalizing to
-- "s" would match any row containing the letter s anywhere, and the filter
-- would stop filtering. A token that normalizes to nothing at all — "inc",
-- "avenue", "the" — contributes no constraint, which is the correct reading
-- of a search for a word that carries no identity.
--
-- Each function returns the page of ids plus the total match count, and the
-- route then does its normal select with its own field projection and embeds.
-- Returning rows from here instead would have thrown away the projection
-- added in 014, which exists because unbounded responses blew the MCP tool
-- response cap twice.
-- ---------------------------------------------------------------------------
create or replace function search_ids_generic(
  p_table    text,
  p_q        text,
  p_norm_fn  text,
  p_limit    integer,
  p_offset   integer,
  p_extra    text default null
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_raw   text[];
  v_norm  text[];
  v_where text := 'true';
  v_tok   text;
  v_n     text;
  v_i        integer;
  v_any_norm boolean;
  v_sql   text;
  v_ids   jsonb;
  v_count integer;
begin
  v_raw := array(
    select t from unnest(string_to_array(btrim(lower(coalesce(p_q, ''))), ' ')) as t
     where btrim(t) <> ''
     limit 6
  );

  if array_length(v_raw, 1) is null then
    v_raw := array[]::text[];
  end if;

  v_norm := array[]::text[];
  for v_i in 1 .. coalesce(array_length(v_raw, 1), 0) loop
    execute format('select %I($1)', p_norm_fn) into v_n using v_raw[v_i];
    v_norm := v_norm || coalesce(v_n, '');
  end loop;

  -- Does any token carry identity once normalized?
  v_any_norm := false;
  for v_i in 1 .. coalesce(array_length(v_raw, 1), 0) loop
    if v_norm[v_i] is not null and btrim(v_norm[v_i]) <> '' then
      v_any_norm := true;
    end if;
  end loop;

  for v_i in 1 .. coalesce(array_length(v_raw, 1), 0) loop
    v_tok := v_raw[v_i];
    v_n   := v_norm[v_i];
    if v_n is null or btrim(v_n) = '' then
      -- A token that normalizes away carries no identity — "inc", "llc",
      -- "avenue", "road", "the". It is SKIPPED, not required, so long as
      -- some other token in the query does carry identity. Requiring it
      -- instead was the first version of this function, and it reintroduced
      -- the very bug being fixed from the other side: "West Center Road"
      -- found nothing against a row stored as "14126 W Center Rd", because
      -- the row says "rd" and the query said "road".
      --
      -- When EVERY token normalizes away, the query is nothing but filler
      -- ("inc", "avenue"), and the raw tokens are required after all —
      -- otherwise the search would degrade into returning the whole table.
      if not v_any_norm then
        v_where := v_where || format(
          ' and search_text like %L', '%' || v_tok || '%');
      end if;
    else
      v_where := v_where || format(
        ' and (search_text like %L or ('' '' || search_text) like %L)',
        '%' || v_tok || '%', '% ' || v_n || '%');
    end if;
  end loop;

  if p_extra is not null and btrim(p_extra) <> '' then
    v_where := v_where || ' and ' || p_extra;
  end if;

  v_sql := format(
    'select count(*) from %I where %s', p_table, v_where);
  execute v_sql into v_count;

  v_sql := format(
    'select coalesce(jsonb_agg(id order by created_at desc), ''[]''::jsonb)
       from (select id, created_at from %I where %s
              order by created_at desc
              limit %s offset %s) s',
    p_table, v_where, greatest(coalesce(p_limit, 25), 1), greatest(coalesce(p_offset, 0), 0));
  execute v_sql into v_ids;

  return jsonb_build_object('ids', coalesce(v_ids, '[]'::jsonb), 'count', coalesce(v_count, 0));
end;
$$;

create or replace function search_entity_ids(
  p_q text, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language sql
stable
set search_path = public
as $$
  select search_ids_generic('entities', p_q, 'normalize_entity_name', p_limit, p_offset);
$$;

create or replace function search_property_ids(
  p_q text, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language sql
stable
set search_path = public
as $$
  select search_ids_generic('properties', p_q, 'normalize_address', p_limit, p_offset);
$$;

-- Contacts carry one extra filter the other two do not: needs_verification,
-- added in 014 so "show me everything I am still guessing at" is a query.
-- It is passed through as a predicate rather than applied afterwards, so the
-- count stays truthful.
create or replace function search_contact_ids(
  p_q text,
  p_limit integer default 25,
  p_offset integer default 0,
  p_needs_verification boolean default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  select search_ids_generic(
    'contacts', p_q, 'normalize_person_name', p_limit, p_offset,
    case when p_needs_verification is null then null
         else format('needs_verification is %s', p_needs_verification) end);
$$;
