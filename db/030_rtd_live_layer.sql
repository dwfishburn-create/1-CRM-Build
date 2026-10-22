-- 030_rtd_live_layer.sql — the RTD becomes the team's shared record (10/22/2026)
--
-- Dan, after seeing the colleague view: "I don't like this. It makes it look
-- like I am in control. I want the others to feel that this is collaborative."
-- Decision (Option 2): everything Jami, Trey or Dan saves in the RTD is live in
-- the RTD at once, for all three. Dan's review no longer approves their work;
-- it only decides what is copied into his private CRM ("Sync to CRM"):
--   * Add to CRM       — written into the CRM (same duplicate gate and
--                        conflict check as 029);
--   * Keep in RTD only — stays live in the RTD, never copied to the CRM;
--   * Later            — no change.
-- The author or Dan can Undo an entry that isn't in the CRM yet (it leaves the
-- RTD), and remove an intel note from the RTD.
--
-- How the RTD shows edits that aren't in the CRM: rtd_layer holds, per record
-- and field, the latest RTD value and the CRM value it was based on
-- (crm_base). The RTD shows the layer value while the CRM still holds
-- crm_base; once the CRM itself changes that field (Dan edits it in the CRM,
-- or saves over it in the RTD), the CRM value shows again — Dan's latest word
-- wins. Syncing a change to the CRM re-bases newer RTD edits so they stay on top.
--
-- Builds on 028/029 (applied 10/20/2026). Re-runnable.

begin;

-- ===========================================================================
-- 1. Statuses, base values, the layer
-- ===========================================================================
alter table rtd_changes drop constraint if exists rtd_changes_status_check;
update rtd_changes set status = 'kept' where status = 'rejected';
alter table rtd_changes add constraint rtd_changes_status_check
  check (status in ('pending', 'accepted', 'kept', 'undone'));
alter table rtd_changes add column if not exists base_value jsonb;    -- CRM values when proposed
alter table rtd_changes add column if not exists undone_at timestamptz;
alter table rtd_changes add column if not exists undone_by uuid references rtd_users(id);

alter table rtd_notes drop constraint if exists rtd_notes_status_check;
update rtd_notes set status = 'kept' where status = 'rejected';
alter table rtd_notes add constraint rtd_notes_status_check
  check (status in ('pending', 'accepted', 'kept', 'removed'));
alter table rtd_notes add column if not exists removed_at timestamptz;
alter table rtd_notes add column if not exists removed_by uuid references rtd_users(id);

create table if not exists rtd_layer (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('brand', 'contact', 'requirement')),
  ref_id     uuid not null,          -- entity_id / contact_id / requirement_id
  field      text not null,
  value      jsonb,
  crm_base   jsonb,                  -- the CRM's value this RTD value was based on
  change_id  uuid not null references rtd_changes(id) on delete cascade,
  author_id  uuid not null references rtd_users(id),
  updated_at timestamptz not null default now(),
  unique (kind, ref_id, field)
);
create index if not exists idx_rtd_layer_ref on rtd_layer (kind, ref_id);
alter table rtd_layer enable row level security;
revoke all on rtd_layer from anon, authenticated;

-- ===========================================================================
-- 2. Layer helpers (internal)
-- ===========================================================================

-- A brand's CRM values as the RTD compares them: the editable fields plus
-- the freshness fields that "Still current?" sets.
create or replace function rtd__brand_crm(p_entity_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select rtd__brand_values(p_entity_id) || jsonb_build_object(
           'needs_verification', rb.needs_verification,
           'last_verified_on', rb.last_verified_on,
           'verification_note', rb.verification_note)
    from retail_brands rb where rb.entity_id = p_entity_id;
$$;

-- CRM values with the RTD's still-applicable layer values on top.
create or replace function rtd__overlay(p_kind text, p_ref uuid, p_crm jsonb)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(p_crm, '{}'::jsonb) || coalesce((
    select jsonb_object_agg(l.field, l.value)
      from rtd_layer l
     where l.kind = p_kind and l.ref_id = p_ref
       and rtd__same(l.crm_base, coalesce(p_crm, '{}'::jsonb) -> l.field)), '{}'::jsonb);
$$;

-- Who last changed each still-applicable field, for "Updated by Jami, Oct 22".
create or replace function rtd__layer_info(p_kind text, p_ref uuid, p_crm jsonb)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(l.field, jsonb_build_object(
           'author', (select display_name from rtd_users where id = l.author_id),
           'at', l.updated_at,
           'in_crm', c.status = 'accepted',
           'change_id', l.change_id)), '{}'::jsonb)
    from rtd_layer l join rtd_changes c on c.id = l.change_id
   where l.kind = p_kind and l.ref_id = p_ref
     and rtd__same(l.crm_base, coalesce(p_crm, '{}'::jsonb) -> l.field);
$$;

create or replace function rtd__layer_write(p_kind text, p_ref uuid, p_change uuid, p_author uuid,
                                            p_new jsonb, p_base jsonb)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  k text;
begin
  for k in select jsonb_object_keys(coalesce(p_new, '{}'::jsonb)) loop
    insert into rtd_layer (kind, ref_id, field, value, crm_base, change_id, author_id, updated_at)
    values (p_kind, p_ref, k, p_new -> k, coalesce(p_base, '{}'::jsonb) -> k, p_change, p_author, now())
    on conflict (kind, ref_id, field) do update
      set value = excluded.value, crm_base = excluded.crm_base, change_id = excluded.change_id,
          author_id = excluded.author_id, updated_at = excluded.updated_at;
  end loop;
end
$$;

-- After a change reached the CRM: its own layer rows go (the CRM holds the
-- value now); newer RTD edits based on the old CRM value are re-based so they
-- stay on top. p_direct (Dan's own save): drop every layer row for those
-- fields instead — Dan's latest word wins.
create or replace function rtd__layer_after_crm(p_kind text, p_ref uuid, p_change uuid,
                                                p_pre jsonb, p_post jsonb, p_fields text[], p_direct boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_direct then
    delete from rtd_layer where kind = p_kind and ref_id = p_ref and field = any (p_fields);
    return;
  end if;
  delete from rtd_layer where kind = p_kind and ref_id = p_ref and change_id = p_change;
  update rtd_layer l
     set crm_base = coalesce(p_post, '{}'::jsonb) -> l.field
   where l.kind = p_kind and l.ref_id = p_ref and l.field = any (p_fields)
     and rtd__same(l.crm_base, coalesce(p_pre, '{}'::jsonb) -> l.field);
  -- Other changes still waiting to sync were based on the old CRM value too;
  -- move their base along, so syncing them next isn't flagged as a conflict.
  update rtd_changes c2
     set base_value = c2.base_value || coalesce((
           select jsonb_object_agg(k, coalesce(p_post, '{}'::jsonb) -> k)
             from jsonb_object_keys(c2.base_value) k
            where k = any (p_fields) and rtd__same(c2.base_value -> k, coalesce(p_pre, '{}'::jsonb) -> k)), '{}'::jsonb)
   where c2.status = 'pending' and c2.id <> p_change and c2.base_value is not null
     and jsonb_typeof(c2.base_value) = 'object'
     and case p_kind
           when 'brand' then c2.kind in ('brand_edit', 'verify') and c2.entity_id = p_ref
           when 'contact' then c2.kind = 'contact_update' and (c2.payload ->> 'contact_id')::uuid = p_ref
           else c2.kind = 'requirement_update' and (c2.payload ->> 'requirement_id')::uuid = p_ref end;
end
$$;

-- The layer kind, record and CRM values a change belongs to.
create or replace function rtd__change_target(c rtd_changes)
returns table (kind text, ref uuid, crm jsonb)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case when c.kind in ('brand_edit', 'verify') then 'brand'
              when c.kind = 'contact_update' then 'contact'
              when c.kind = 'requirement_update' then 'requirement' end,
         case when c.kind in ('brand_edit', 'verify') then c.entity_id
              when c.kind = 'contact_update' then (c.payload ->> 'contact_id')::uuid
              when c.kind = 'requirement_update' then (c.payload ->> 'requirement_id')::uuid end,
         case when c.kind in ('brand_edit', 'verify') then rtd__brand_crm(c.entity_id)
              when c.kind = 'contact_update' then rtd__contact_values((c.payload ->> 'contact_id')::uuid)
              when c.kind = 'requirement_update' then rtd__req_values((c.payload ->> 'requirement_id')::uuid) end;
$$;

-- The values a verify writes, as layer/CRM fields.
create or replace function rtd__verify_values(c rtd_changes)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'needs_verification', false,
    'last_verified_on', (c.created_at at time zone 'America/Chicago')::date,
    'verification_note', 'Confirmed current in the RTD by '
       || (select display_name from rtd_users where id = c.author_id)
       || coalesce(': ' || nullif(btrim(c.payload ->> 'note'), ''), ''));
$$;

revoke execute on function rtd__brand_crm(uuid)                                   from public, anon, authenticated;
revoke execute on function rtd__overlay(text, uuid, jsonb)                         from public, anon, authenticated;
revoke execute on function rtd__layer_info(text, uuid, jsonb)                      from public, anon, authenticated;
revoke execute on function rtd__layer_write(text, uuid, uuid, uuid, jsonb, jsonb)  from public, anon, authenticated;
revoke execute on function rtd__layer_after_crm(text, uuid, uuid, jsonb, jsonb, text[], boolean) from public, anon, authenticated;
revoke execute on function rtd__change_target(rtd_changes)                         from public, anon, authenticated;
revoke execute on function rtd__verify_values(rtd_changes)                         from public, anon, authenticated;

-- ===========================================================================
-- 3. Saving: live in the RTD at once; Dan's own saves also go into the CRM
-- ===========================================================================
drop function if exists rtd__submit(text, uuid, jsonb, jsonb, jsonb, boolean);
create or replace function rtd__submit(p_kind text, p_entity_id uuid, p_old jsonb, p_new jsonb, p_payload jsonb,
                                       p_force boolean default false, p_base jsonb default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
  v_id uuid;
  c rtd_changes;
  t record;
  r jsonb;
  post jsonb;
  newv jsonb;
begin
  insert into rtd_changes (entity_id, kind, old_value, new_value, payload, author_id, base_value)
  values (p_entity_id, p_kind, p_old, p_new, coalesce(p_payload, '{}'::jsonb), u.id, p_base)
  returning * into c;
  v_id := c.id;
  select * into t from rtd__change_target(c);
  newv := case when p_kind = 'verify' then rtd__verify_values(c) else p_new end;

  if not u.is_admin then
    if t.kind is not null then
      perform rtd__layer_write(t.kind, t.ref, v_id, u.id, newv, coalesce(p_base, t.crm));
    end if;
    return jsonb_build_object('status', 'saved', 'id', v_id);
  end if;

  r := rtd__apply(v_id, p_force);
  if r ->> 'status' = 'applied' then
    update rtd_changes set status = 'accepted', reviewed_at = now(), reviewed_by = u.id,
                           result_ref = r ->> 'result_ref'
     where id = v_id;
    if t.kind is not null then
      perform rtd__layer_after_crm(t.kind, t.ref, v_id, t.crm, null,
                                   array(select jsonb_object_keys(newv)), true);
    end if;
    return r || jsonb_build_object('id', v_id);
  end if;
  delete from rtd_changes where id = v_id;
  return r;
end
$$;
revoke execute on function rtd__submit(text, uuid, jsonb, jsonb, jsonb, boolean, jsonb) from public, anon, authenticated;

-- Profile edits diff against what the RTD shows now (CRM + layer); the CRM
-- values are kept as the base.
create or replace function rtd_propose_edit(p_entity_id uuid, p_fields jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  crm jsonb;
  cur jsonb;
  f jsonb;
  newv jsonb := '{}'::jsonb;
  oldv jsonb := '{}'::jsonb;
  basev jsonb := '{}'::jsonb;
  k text;
  merged jsonb;
begin
  perform rtd_current_user();
  crm := rtd__brand_crm(p_entity_id);
  if crm is null then
    raise exception 'RTD: that brand isn''t in the directory' using errcode = '22023';
  end if;
  cur := rtd__overlay('brand', p_entity_id, crm);
  f := rtd__clean_brand_fields(p_fields);
  for k in select jsonb_object_keys(f) loop
    if not rtd__same(f -> k, cur -> k) then
      newv := newv || jsonb_build_object(k, f -> k);
      oldv := oldv || jsonb_build_object(k, cur -> k);
      basev := basev || jsonb_build_object(k, crm -> k);
    end if;
  end loop;
  if newv = '{}'::jsonb then
    return jsonb_build_object('status', 'no_change');
  end if;
  merged := cur || newv;
  if (merged ->> 'size_min_sf')::numeric > (merged ->> 'size_max_sf')::numeric then
    raise exception 'RTD: the minimum size is larger than the maximum' using errcode = '22023';
  end if;
  return rtd__submit('brand_edit', p_entity_id, oldv, newv, '{}'::jsonb, false, basev);
end
$$;

create or replace function rtd_update_contact(p_entity_id uuid, p_contact_id uuid, p_fields jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  crm jsonb;
  cur jsonb;
  f jsonb;
  newv jsonb := '{}'::jsonb;
  oldv jsonb := '{}'::jsonb;
  basev jsonb := '{}'::jsonb;
  k text;
begin
  perform rtd_current_user();
  if not rtd__contact_on_brand(p_contact_id, p_entity_id) then
    raise exception 'RTD: that person isn''t linked to this brand' using errcode = '22023';
  end if;
  crm := rtd__contact_values(p_contact_id);
  cur := rtd__overlay('contact', p_contact_id, crm);
  f := rtd__clean_contact_fields(p_fields) - 'role';
  for k in select jsonb_object_keys(f) loop
    if not rtd__same(f -> k, cur -> k) then
      newv := newv || jsonb_build_object(k, f -> k);
      oldv := oldv || jsonb_build_object(k, cur -> k);
      basev := basev || jsonb_build_object(k, crm -> k);
    end if;
  end loop;
  if newv = '{}'::jsonb then
    return jsonb_build_object('status', 'no_change');
  end if;
  return rtd__submit('contact_update', p_entity_id, oldv, newv,
                     jsonb_build_object('contact_id', p_contact_id), false, basev);
end
$$;

create or replace function rtd_mark_verified(p_entity_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform rtd_current_user();
  if not exists (select 1 from retail_brands where entity_id = p_entity_id) then
    raise exception 'RTD: that brand isn''t in the directory' using errcode = '22023';
  end if;
  return rtd__submit('verify', p_entity_id, null, null,
                     jsonb_build_object('note', left(nullif(btrim(coalesce(p_note, '')), ''), 500)),
                     false, rtd__brand_crm(p_entity_id));
end
$$;

-- Requirement updates: a requirement already in the CRM is edited like a
-- profile (layer + base). One still RTD-only (a new_requirement change not in
-- the CRM, p_id = its change id) is edited in place.
create or replace function rtd_update_requirement(p_id uuid, p_fields jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
  crm jsonb;
  cur jsonb;
  f jsonb;
  newv jsonb := '{}'::jsonb;
  oldv jsonb := '{}'::jsonb;
  basev jsonb := '{}'::jsonb;
  k text;
  merged jsonb;
  pc rtd_changes;
begin
  f := rtd__clean_req_fields(p_fields);

  select * into pc from rtd_changes where id = p_id and kind = 'new_requirement' and status in ('pending', 'kept');
  if found then
    cur := pc.payload;
    for k in select jsonb_object_keys(f) loop
      if not rtd__same(f -> k, cur -> k) then
        newv := newv || jsonb_build_object(k, f -> k);
      end if;
    end loop;
    if newv = '{}'::jsonb then
      return jsonb_build_object('status', 'no_change');
    end if;
    merged := cur || newv;
    if (merged ->> 'size_min')::numeric > (merged ->> 'size_max')::numeric then
      raise exception 'RTD: the minimum size is larger than the maximum' using errcode = '22023';
    end if;
    if (merged ->> 'budget_min')::numeric > (merged ->> 'budget_max')::numeric then
      raise exception 'RTD: the minimum budget is larger than the maximum' using errcode = '22023';
    end if;
    update rtd_changes
       set payload = merged,
           review_note = concat_ws(E'\n', review_note,
             to_char(now() at time zone 'America/Chicago', 'FMMM/FMDD/YYYY') || ' — edited by ' || u.display_name)
     where id = pc.id;
    return jsonb_build_object('status', 'saved', 'id', pc.id);
  end if;

  if not exists (select 1 from requirements where id = p_id and rtd_shared) then
    raise exception 'RTD: that requirement isn''t shared to the RTD' using errcode = '22023';
  end if;
  crm := rtd__req_values(p_id);
  cur := rtd__overlay('requirement', p_id, crm);
  for k in select jsonb_object_keys(f) loop
    if not rtd__same(f -> k, cur -> k) then
      newv := newv || jsonb_build_object(k, f -> k);
      oldv := oldv || jsonb_build_object(k, cur -> k);
      basev := basev || jsonb_build_object(k, crm -> k);
    end if;
  end loop;
  if newv = '{}'::jsonb then
    return jsonb_build_object('status', 'no_change');
  end if;
  merged := cur || newv;
  if (merged ->> 'size_min')::numeric > (merged ->> 'size_max')::numeric then
    raise exception 'RTD: the minimum size is larger than the maximum' using errcode = '22023';
  end if;
  if (merged ->> 'budget_min')::numeric > (merged ->> 'budget_max')::numeric then
    raise exception 'RTD: the minimum budget is larger than the maximum' using errcode = '22023';
  end if;
  return rtd__submit('requirement_update', (select p.entity_id from rtd__req_party(p_id) p), oldv, newv,
                     jsonb_build_object('requirement_id', p_id), false, basev);
end
$$;

-- ===========================================================================
-- 4. Undo and remove (the author or Dan; only what isn't in the CRM)
-- ===========================================================================
create or replace function rtd_undo(p_change_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
  c rtd_changes;
begin
  select * into c from rtd_changes where id = p_change_id for update;
  if not found then
    raise exception 'RTD: nothing to undo' using errcode = '22023';
  end if;
  if c.author_id <> u.id and not u.is_admin then
    raise exception 'RTD: only the person who saved it, or Dan, can undo it' using errcode = '42501';
  end if;
  if c.status = 'accepted' then
    raise exception 'RTD: this is already in Dan''s CRM — change it with a new edit instead' using errcode = '22023';
  end if;
  if c.status = 'undone' then
    return jsonb_build_object('status', 'undone');
  end if;
  update rtd_changes set status = 'undone', undone_at = now(), undone_by = u.id where id = c.id;
  delete from rtd_layer where change_id = c.id;
  return jsonb_build_object('status', 'undone');
end
$$;

create or replace function rtd_remove_note(p_note_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
  n rtd_notes;
begin
  select * into n from rtd_notes where id = p_note_id for update;
  if not found then
    raise exception 'RTD: that note no longer exists' using errcode = '22023';
  end if;
  if n.author_id <> u.id and not u.is_admin then
    raise exception 'RTD: only the person who wrote it, or Dan, can remove it' using errcode = '42501';
  end if;
  update rtd_notes set status = 'removed', removed_at = now(), removed_by = u.id where id = n.id;
  return jsonb_build_object('status', 'removed', 'in_crm', n.activity_log_id is not null);
end
$$;

-- ===========================================================================
-- 5. Sync to CRM (Dan): Add to CRM / Keep in RTD only / Later
-- ===========================================================================
create or replace function rtd_review(p_type text, p_id uuid, p_decision text, p_force boolean default false,
                                      p_link_contact_id uuid default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd__require_admin();
  r jsonb;
  n rtd_notes;
  c rtd_changes;
  t record;
  post jsonb;
  newv jsonb;
begin
  p_decision := lower(btrim(coalesce(p_decision, '')));
  p_decision := case
    when p_decision in ('accept', 'add', 'add to crm', 'sync') then 'accept'
    when p_decision in ('reject', 'keep', 'keep in rtd', 'keep in rtd only') then 'keep'
    when p_decision in ('', 'leave', 'later') then 'later'
    else p_decision end;
  if p_decision = 'later' then
    return jsonb_build_object('status', 'left');
  end if;
  if p_decision not in ('accept', 'keep') then
    raise exception 'RTD: choose Add to CRM, Keep in RTD only or Later' using errcode = '22023';
  end if;

  if p_type = 'note' then
    select * into n from rtd_notes where id = p_id for update;
    if not found or n.status <> 'pending' then
      return jsonb_build_object('status', 'gone', 'message', 'That note was already handled.');
    end if;
    if p_decision = 'accept' then
      perform rtd__note_to_crm(p_id);
    end if;
    update rtd_notes set status = case p_decision when 'accept' then 'accepted' else 'kept' end,
                         reviewed_at = now(), reviewed_by = u.id
     where id = p_id;
    return jsonb_build_object('status', case p_decision when 'accept' then 'accepted' else 'kept' end);
  end if;

  if p_type <> 'change' then
    raise exception 'RTD: unknown item type %', p_type using errcode = '22023';
  end if;

  select * into c from rtd_changes where id = p_id;
  if not found or c.status <> 'pending' then
    return jsonb_build_object('status', 'gone', 'message', 'That item was already handled.');
  end if;

  if p_decision = 'keep' then
    update rtd_changes set status = 'kept', reviewed_at = now(), reviewed_by = u.id,
                           review_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_id;
    return jsonb_build_object('status', 'kept');
  end if;

  select * into t from rtd__change_target(c);
  r := rtd__apply(p_id, coalesce(p_force, false), p_link_contact_id);
  if r ->> 'status' <> 'applied' then
    return r;
  end if;
  update rtd_changes set status = 'accepted', reviewed_at = now(), reviewed_by = u.id,
                         result_ref = r ->> 'result_ref', review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;
  if t.kind is not null then
    post := case t.kind when 'brand' then rtd__brand_crm(t.ref)
                        when 'contact' then rtd__contact_values(t.ref)
                        else rtd__req_values(t.ref) end;
    newv := case when c.kind = 'verify' then rtd__verify_values(c) else c.new_value end;
    perform rtd__layer_after_crm(t.kind, t.ref, c.id, t.crm, post, array(select jsonb_object_keys(newv)), false);
  end if;
  return r || jsonb_build_object('status', 'accepted');
end
$$;

-- ===========================================================================
-- 6. Reading: what the RTD shows is the CRM with the team's live edits on top
-- ===========================================================================

-- Every brand profile as the RTD sees it (search, Fits this space, export).
create or replace function rtd__effective_brands()
returns setof retail_brands
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case when l.ov is null then rb else jsonb_populate_record(rb, l.ov) end
    from retail_brands rb
    left join lateral (
      select jsonb_object_agg(x.field, x.value) as ov
        from rtd_layer x
       where x.kind = 'brand' and x.ref_id = rb.entity_id and x.field <> 'website'
         and rtd__same(x.crm_base, rtd__brand_crm(rb.entity_id) -> x.field)
    ) l on true;
$$;
revoke execute on function rtd__effective_brands() from public, anon, authenticated;

-- One brand. Profile fields, freshness, contacts and requirements include the
-- team's RTD edits; field_updates says who changed what (and, for Dan,
-- whether it is in the CRM yet).
create or replace function rtd_brand(p_entity_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
  v jsonb;
  crm jsonb;
  ov jsonb;
  contacts jsonb;
  reqs jsonb;
begin
  select jsonb_build_object(
    'entity_id', e.id, 'display_code', e.display_code, 'name', e.name,
    'trade_name', e.trade_name, 'profile_notes', rb.notes,
    'source_system', rb.source_system, 'profile_created_at', rb.created_at,
    'profile_updated_at', rb.updated_at,
    'metro_locations', (select count(distinct x.property_id) from (
        select pt.property_id from property_tenant pt where pt.entity_id = e.id and pt.is_current
        union
        select s.property_id from leases l join spaces s on s.id = l.space_id
         where l.tenant_entity_id = e.id and l.is_current) x))
  into v
  from retail_brands rb join entities e on e.id = rb.entity_id
  where e.id = p_entity_id;
  if v is null then
    return null;   -- not a brand in the directory
  end if;

  crm := rtd__brand_crm(p_entity_id);
  ov := rtd__overlay('brand', p_entity_id, crm);
  v := v || ov || jsonb_build_object(
    'category_label', (select rc.label from retail_categories rc where rc.code = ov ->> 'category'),
    'field_updates', rtd__layer_info('brand', p_entity_id, crm));

  -- Contacts: CRM people (with RTD updates and "no longer there" reports on
  -- top), then people added in the RTD that aren't in the CRM yet.
  select coalesce(jsonb_agg(x.j order by x.cur desc, x.broker, x.lname), '[]'::jsonb) into contacts
  from (
    select jsonb_build_object(
             'contact_id', c.id,
             'name', btrim(coalesce(cv ->> 'first_name', '') || ' ' || coalesce(cv ->> 'last_name', '')),
             'title', cv ->> 'title', 'email', cv ->> 'email', 'phone', cv ->> 'phone', 'mobile', cv ->> 'mobile_phone',
             'role', p.role,
             'is_current', p.is_current and lf.change_id is null,
             'ended_on', coalesce(p.ended_on, lf.reported_on),
             'left_reported_by', lf.who, 'left_change_id', lf.change_id, 'left_in_crm', false,
             'updates', rtd__layer_info('contact', c.id, rtd__contact_values(c.id))) as j,
           (p.is_current and lf.change_id is null) as cur,
           (coalesce(p.role, '') = 'Tenant Rep Broker') as broker,
           c.last_name as lname
      from (
        select ce.contact_id, ce.role, ce.is_current, ce.ended_on
          from contact_entities ce where ce.entity_id = p_entity_id
        union
        select c2.id, null, true, null
          from contacts c2
         where c2.entity_id = p_entity_id
           and not exists (select 1 from contact_entities x where x.contact_id = c2.id and x.entity_id = p_entity_id)
      ) p
      join contacts c on c.id = p.contact_id
      cross join lateral (select rtd__overlay('contact', c.id, rtd__contact_values(c.id)) as cv) o
      left join lateral (
        select ch.id as change_id, rtd__who(ch.author_id) as who,
               (ch.created_at at time zone 'America/Chicago')::date as reported_on
          from rtd_changes ch
         where ch.kind = 'contact_left' and ch.entity_id = p_entity_id and ch.status in ('pending', 'kept')
           and (ch.payload ->> 'contact_id')::uuid = c.id and p.is_current
         order by ch.created_at desc limit 1) lf on true
    union all
    select jsonb_build_object(
             'contact_id', null, 'change_id', ch.id,
             'name', btrim(coalesce(ch.payload ->> 'first_name', '') || ' ' || coalesce(ch.payload ->> 'last_name', '')),
             'title', ch.payload ->> 'title', 'email', ch.payload ->> 'email', 'phone', ch.payload ->> 'phone',
             'mobile', ch.payload ->> 'mobile_phone', 'role', nullif(ch.payload ->> 'role', ''),
             'is_current', true, 'ended_on', null,
             'added_by', rtd__who(ch.author_id), 'added_at', ch.created_at,
             'in_crm', false, 'can_undo', (ch.author_id = u.id or u.is_admin)),
           true, (coalesce(ch.payload ->> 'role', '') = 'Tenant Rep Broker'), ch.payload ->> 'last_name'
      from rtd_changes ch
     where ch.kind = 'new_contact' and ch.entity_id = p_entity_id and ch.status in ('pending', 'kept')
  ) x;

  -- Requirements: shared CRM ones (with RTD updates on top) and ones added in
  -- the RTD that aren't in the CRM yet. Structured fields only.
  select coalesce(jsonb_agg(y.j order by y.active desc, y.d desc nulls last), '[]'::jsonb) into reqs
  from (
    select jsonb_build_object('id', r.id, 'display_code', r.display_code, 'reconfirm_date', r.reconfirm_date,
                              'in_crm', true) || rv.v as j,
           coalesce(rv.v ->> 'status', 'active') = 'active' as active,
           (rv.v ->> 'source_date')::date as d
      from requirement_parties rp join requirements r on r.id = rp.requirement_id
      cross join lateral (select rtd__overlay('requirement', r.id, rtd__req_values(r.id)) as v) rv
     where rp.entity_id = p_entity_id and r.rtd_shared
    union all
    select jsonb_build_object('id', ch.id, 'display_code', 'New', 'reconfirm_date', null, 'in_crm', false,
                              'added_by', rtd__who(ch.author_id))
             || (ch.payload - 'entity_id' - 'party_name'),
           coalesce(ch.payload ->> 'status', 'active') = 'active',
           coalesce((ch.payload ->> 'source_date')::date, (ch.created_at at time zone 'America/Chicago')::date)
      from rtd_changes ch
     where ch.kind = 'new_requirement' and ch.entity_id = p_entity_id and ch.status in ('pending', 'kept')
  ) y;

  return v || jsonb_build_object('contacts', contacts, 'requirements', reqs);
end
$$;

-- A brand added in the RTD that isn't in the CRM yet (its page while it waits).
create or replace function rtd_new_brand(p_change_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
begin
  return (
    select (c.payload - 'name') || jsonb_build_object(
             'change_id', c.id, 'name', c.payload ->> 'name', 'added_by', rtd__who(c.author_id),
             'added_at', c.created_at, 'status', c.status,
             'can_undo', (c.author_id = u.id or u.is_admin),
             'category_label', (select rc.label from retail_categories rc where rc.code = c.payload ->> 'category'))
      from rtd_changes c
     where c.id = p_change_id and c.kind = 'new_brand' and c.status in ('pending', 'kept'));
end
$$;

-- Brands added in the RTD that aren't in the CRM yet (shown on All brands).
create or replace function rtd_new_brands()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform rtd_current_user();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'change_id', c.id, 'name', c.payload ->> 'name', 'added_by', rtd__who(c.author_id),
             'added_at', c.created_at, 'status', c.status,
             'category_label', (select rc.label from retail_categories rc where rc.code = c.payload ->> 'category'),
             'size_min_sf', c.payload -> 'size_min_sf', 'size_max_sf', c.payload -> 'size_max_sf')
           order by c.created_at desc)
      from rtd_changes c
     where c.kind = 'new_brand' and c.status in ('pending', 'kept')), '[]'::jsonb);
end
$$;

-- What the team has done on a brand: notes, the update history (with Undo
-- where allowed), claim, and who last confirmed it current.
create or replace function rtd_brand_activity(p_entity_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
begin
  return jsonb_build_object(
    'me', jsonb_build_object('is_admin', u.is_admin, 'display_name', u.display_name),
    'claim', (select to_jsonb(c) from rtd__claims_for(array[p_entity_id]) c limit 1),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'author', rtd__who(n.author_id), 'mine', n.author_id = u.id,
                                          'body', n.body, 'tags', to_jsonb(n.tags), 'created_at', n.created_at,
                                          'status', n.status, 'in_crm', n.status = 'accepted',
                                          'can_remove', (n.author_id = u.id or u.is_admin))
                       order by n.created_at desc)
        from rtd_notes n where n.entity_id = p_entity_id and n.status <> 'removed'), '[]'::jsonb),
    'pending', '[]'::jsonb,
    'history', coalesce((
      select jsonb_agg(h.x order by h.at desc) from (
        select * from (
          select c.created_at as at,
                 jsonb_build_object('id', c.id, 'at', c.created_at, 'kind', c.kind, 'status', c.status,
                                    'in_crm', c.status = 'accepted',
                                    'can_undo', c.status in ('pending', 'kept') and (c.author_id = u.id or u.is_admin),
                                    'author', rtd__who(c.author_id),
                                    'old_value', c.old_value, 'new_value', c.new_value, 'payload', c.payload,
                                    'result_ref', c.result_ref,
                                    'contact_name', (select btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, ''))
                                                       from contacts ct where ct.id = (c.payload ->> 'contact_id')::uuid)) as x
            from rtd_changes c
           where c.entity_id = p_entity_id and c.status <> 'undone'
          union all
          select cl.claimed_at, jsonb_build_object('at', cl.claimed_at, 'kind', 'claim', 'status', 'accepted',
                                                   'in_crm', true, 'author', rtd__who(cl.claimed_by))
            from rtd_claims cl where cl.entity_id = p_entity_id
          union all
          select cl.released_at, jsonb_build_object('at', cl.released_at, 'kind', 'release', 'status', 'accepted',
                                                    'in_crm', true, 'author', rtd__who(cl.released_by))
            from rtd_claims cl where cl.entity_id = p_entity_id and cl.released_at is not null
        ) all_h order by all_h.at desc limit 50) h), '[]'::jsonb),
    'verified_by', (
      select rtd__who(c.author_id) from rtd_changes c
       where c.entity_id = p_entity_id and c.kind = 'verify' and c.status <> 'undone'
       order by c.created_at desc limit 1)
  );
end
$$;

-- ===========================================================================
-- 7. Requirements as the RTD sees them
-- ===========================================================================
drop function if exists rtd_requirements(text, text, text, text, numeric, text, int, int);
create or replace function rtd_requirements(
  p_status        text    default 'active',
  p_property_type text    default null,
  p_deal_type     text    default null,
  p_market        text    default null,
  p_size          numeric default null,
  p_q             text    default null,
  p_limit         int     default 200,
  p_offset        int     default 0
)
returns table (
  id uuid, display_code text, party text, entity_id uuid, is_brand boolean,
  deal_type text, property_type text, size_min numeric, size_max numeric,
  budget_min numeric, budget_max numeric, target_location text, target_markets text[],
  timeline text, status text, confidence text, source_date date, reconfirm_date date,
  rtd_note text, rtd_contact text, added_by text, shared_at timestamptz, updated_at timestamptz,
  rtd_only boolean, not_in_crm boolean, total_count bigint
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  perform rtd_current_user();
  if p_limit is null or p_limit < 1 then p_limit := 200; end if;
  if p_limit > 5000 then p_limit := 5000; end if;
  return query
  with allr as (
    select r.id as rid, r.display_code as code, pty.name as pname, pty.entity_id as peid, pty.is_brand as pbrand,
           rtd__overlay('requirement', r.id, rtd__req_values(r.id)) as v,
           r.reconfirm_date as rdate, r.rtd_shared_at as sat, r.updated_at as uat, r.created_at as cat,
           (select rtd__who(c.author_id) from rtd_changes c
             where c.kind = 'new_requirement' and c.status = 'accepted'
               and c.payload ->> 'requirement_id' = r.id::text limit 1) as who,
           false as only_rtd,
           exists (select 1 from rtd_changes c
                    where c.kind = 'requirement_update' and c.status = 'pending'
                      and c.payload ->> 'requirement_id' = r.id::text) as unsynced
      from requirements r cross join lateral rtd__req_party(r.id) pty
     where r.rtd_shared
    union all
    select c.id, 'New', coalesce(e.name, c.payload ->> 'party_name'), c.entity_id,
           (c.entity_id is not null and exists (select 1 from retail_brands rb where rb.entity_id = c.entity_id)),
           c.payload, null::date, c.created_at, c.created_at, c.created_at,
           rtd__who(c.author_id), true, c.status = 'pending'
      from rtd_changes c left join entities e on e.id = c.entity_id
     where c.kind = 'new_requirement' and c.status in ('pending', 'kept')
  ), f as (
    select a.*,
           coalesce(a.v ->> 'status', 'active') as st,
           array(select jsonb_array_elements_text(coalesce(a.v -> 'target_markets', '[]'::jsonb))) as mk,
           (a.v ->> 'size_min')::numeric as smin, (a.v ->> 'size_max')::numeric as smax
      from allr a
  )
  select f.rid, f.code, f.pname, f.peid, f.pbrand,
         f.v ->> 'deal_type', f.v ->> 'property_type', f.smin, f.smax,
         (f.v ->> 'budget_min')::numeric, (f.v ->> 'budget_max')::numeric, f.v ->> 'target_location', f.mk,
         f.v ->> 'timeline', f.st, f.v ->> 'confidence', (f.v ->> 'source_date')::date, f.rdate,
         f.v ->> 'rtd_note', f.v ->> 'rtd_contact', f.who, f.sat, f.uat,
         f.only_rtd, (f.only_rtd and f.unsynced) or (not f.only_rtd and f.unsynced),
         count(*) over ()
    from f
   where (coalesce(p_status, '') = '' or f.st = p_status)
     and (nullif(p_property_type, '') is null or lower(f.v ->> 'property_type') = lower(p_property_type))
     and (nullif(p_deal_type, '') is null or lower(f.v ->> 'deal_type') = lower(p_deal_type))
     and (nullif(p_market, '') is null or f.mk = '{}' or p_market = any (f.mk))
     and (p_size is null or ((f.smin is null or f.smin <= p_size) and (f.smax is null or f.smax >= p_size)))
     and (v_q is null or f.pname ilike '%' || v_q || '%' or (f.v ->> 'target_location') ilike '%' || v_q || '%'
          or f.code ilike v_q || '%')
   order by f.st = 'active' desc, coalesce((f.v ->> 'source_date')::date, f.cat::date) desc, f.code desc
   limit p_limit offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- One requirement: a shared CRM one (with RTD updates on top), or one added in
-- the RTD that isn't in the CRM yet (p_id = its change id). Null otherwise.
create or replace function rtd_requirement(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  u rtd_users := rtd_current_user();
  crm jsonb;
  pc rtd_changes;
begin
  select * into pc from rtd_changes where id = p_id and kind = 'new_requirement' and status in ('pending', 'kept');
  if found then
    return (pc.payload - 'entity_id' - 'party_name') || jsonb_build_object(
      'id', pc.id, 'display_code', 'New', 'rtd_only', true, 'in_crm', false,
      'not_in_crm', pc.status = 'pending',
      'party', coalesce((select e.name from entities e where e.id = pc.entity_id), pc.payload ->> 'party_name'),
      'entity_id', pc.entity_id,
      'is_brand', exists (select 1 from retail_brands rb where rb.entity_id = pc.entity_id),
      'added_by', rtd__who(pc.author_id), 'created_at', pc.created_at, 'shared_at', pc.created_at,
      'updated_at', pc.created_at, 'reconfirm_date', null,
      'can_undo', (pc.author_id = u.id or u.is_admin),
      'edit_log', pc.review_note,
      'me', jsonb_build_object('is_admin', u.is_admin),
      'field_updates', '{}'::jsonb, 'history', '[]'::jsonb);
  end if;

  if not exists (select 1 from requirements where id = p_id and rtd_shared) then
    return null;
  end if;
  crm := rtd__req_values(p_id);
  return (
    select rtd__overlay('requirement', r.id, crm) || jsonb_build_object(
             'id', r.id, 'display_code', r.display_code, 'reconfirm_date', r.reconfirm_date,
             'rtd_only', false, 'in_crm', true,
             'shared_at', r.rtd_shared_at, 'created_at', r.created_at, 'updated_at', r.updated_at,
             'party', pty.name, 'entity_id', pty.entity_id, 'is_brand', pty.is_brand,
             'me', jsonb_build_object('is_admin', u.is_admin),
             'added_by', (select rtd__who(c.author_id) from rtd_changes c
                           where c.kind = 'new_requirement' and c.status = 'accepted'
                             and c.payload ->> 'requirement_id' = r.id::text limit 1),
             'field_updates', rtd__layer_info('requirement', r.id, crm),
             'history', coalesce((
               select jsonb_agg(jsonb_build_object('id', c.id, 'at', c.created_at, 'kind', c.kind, 'status', c.status,
                                                   'in_crm', c.status = 'accepted',
                                                   'can_undo', c.status in ('pending', 'kept') and (c.author_id = u.id or u.is_admin),
                                                   'author', rtd__who(c.author_id),
                                                   'old_value', c.old_value, 'new_value', c.new_value, 'payload', c.payload,
                                                   'result_ref', c.result_ref) order by c.created_at desc)
                 from rtd_changes c
                where c.kind in ('new_requirement', 'requirement_update') and c.status <> 'undone'
                  and c.payload ->> 'requirement_id' = r.id::text), '[]'::jsonb))
      from requirements r cross join lateral rtd__req_party(r.id) pty
     where r.id = p_id);
end
$$;

-- ===========================================================================
-- 8. Carried over from 029 with small changes
--    rtd__apply / rtd__apply_requirement: the conflict check compares the CRM
--      with the CRM value the change was based on (base_value), not with what
--      the RTD showed (old_value), since the RTD may show newer team edits.
--    rtd_whats_new: removed notes and undone changes drop out; RTD-only new
--      brands and requirements link to their pages.
--    rtd_review_queue: same conflict basis as rtd__apply.
-- ===========================================================================
create or replace function rtd__apply(p_change_id uuid, p_force boolean default false, p_link_contact_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  c rtd_changes;
  who text;
  cur jsonb;
  conf text[];
  f jsonb;
  matches jsonb;
  v_entity uuid;
  v_contact uuid;
  v_code text;
  k text;
begin
  select * into c from rtd_changes where id = p_change_id for update;
  if not found or c.status <> 'pending' then
    return jsonb_build_object('status', 'gone', 'message', 'That item was already handled.');
  end if;
  select display_name into who from rtd_users where id = c.author_id;

  if c.kind in ('brand_edit', 'verify', 'new_contact', 'contact_update', 'contact_left')
     and not exists (select 1 from retail_brands where entity_id = c.entity_id) then
    return jsonb_build_object('status', 'gone', 'message', 'That brand is no longer in the directory.');
  end if;

  if c.kind = 'brand_edit' then
    cur := rtd__brand_values(c.entity_id);
    conf := rtd__conflicts(coalesce(c.base_value, c.old_value), cur);
    if conf <> '{}' and not p_force then
      return jsonb_build_object('status', 'conflict', 'fields', to_jsonb(conf), 'current', cur,
        'message', 'The CRM changed since this was proposed: ' || array_to_string(array(select replace(x, '_', ' ') from unnest(conf) x), ', '));
    end if;
    f := c.new_value;
    if f ? 'website' then
      update entities set website = f ->> 'website', updated_at = now() where id = c.entity_id;
    end if;
    update retail_brands rb set
      category        = case when f ? 'category'        then f ->> 'category'                 else rb.category end,
      category_detail = case when f ? 'category_detail' then f ->> 'category_detail'          else rb.category_detail end,
      size_min_sf     = case when f ? 'size_min_sf'     then (f ->> 'size_min_sf')::numeric   else rb.size_min_sf end,
      size_max_sf     = case when f ? 'size_max_sf'     then (f ->> 'size_max_sf')::numeric   else rb.size_max_sf end,
      frontage_min_ft = case when f ? 'frontage_min_ft' then (f ->> 'frontage_min_ft')::numeric else rb.frontage_min_ft end,
      drive_thru      = case when f ? 'drive_thru'      then f ->> 'drive_thru'               else rb.drive_thru end,
      facility_types  = case when f ? 'facility_types'
                             then array(select jsonb_array_elements_text(f -> 'facility_types')) else rb.facility_types end,
      site_criteria   = case when f ? 'site_criteria'   then f ->> 'site_criteria'            else rb.site_criteria end,
      operating_model = case when f ? 'operating_model' then f ->> 'operating_model'          else rb.operating_model end,
      expansion_status = case when f ? 'expansion_status' then f ->> 'expansion_status'       else rb.expansion_status end,
      target_markets  = case when f ? 'target_markets'
                             then array(select jsonb_array_elements_text(f -> 'target_markets')) else rb.target_markets end
     where rb.entity_id = c.entity_id;
    return jsonb_build_object('status', 'applied');

  elsif c.kind = 'verify' then
    update retail_brands
       set needs_verification = false,
           last_verified_on = (c.created_at at time zone 'America/Chicago')::date,
           verification_note = 'Confirmed current in the RTD by ' || who
                               || coalesce(': ' || nullif(btrim(c.payload ->> 'note'), ''), '')
     where entity_id = c.entity_id;
    return jsonb_build_object('status', 'applied');

  elsif c.kind = 'new_contact' then
    f := c.payload;
    if p_link_contact_id is not null then
      -- Dan picked an existing person: link them to this brand instead of creating one.
      if not exists (select 1 from contacts where id = p_link_contact_id) then
        return jsonb_build_object('status', 'gone', 'message', 'That existing contact no longer exists.');
      end if;
      insert into contact_entities (contact_id, entity_id, role, is_current, source_system, source_record_id)
      values (p_link_contact_id, c.entity_id, f ->> 'role', true, 'rtd', c.id::text)
      on conflict (contact_id, entity_id) do update set is_current = true, ended_on = null,
        role = coalesce(contact_entities.role, excluded.role);
      select display_code into v_code from contacts where id = p_link_contact_id;
      return jsonb_build_object('status', 'applied', 'result_ref', v_code, 'linked', true);
    end if;
    if not p_force then
      select coalesce(jsonb_agg(m), '[]'::jsonb) into matches
        from jsonb_array_elements(find_similar_contacts(f ->> 'first_name', f ->> 'last_name', f ->> 'email', 5)) m
       where (m ->> 'score')::numeric >= 0.8;
      if jsonb_array_length(matches) > 0 then
        return jsonb_build_object('status', 'duplicate', 'matches', matches,
          'message', 'This looks like someone already in the CRM.');
      end if;
    end if;
    v_code := next_display_code('contacts', 'CON');
    insert into contacts (display_code, first_name, last_name, title, email, phone, mobile_phone, entity_id,
                          needs_verification, verification_note, source_system, source_record_id)
    values (v_code, f ->> 'first_name', f ->> 'last_name', f ->> 'title', f ->> 'email', f ->> 'phone',
            f ->> 'mobile_phone', c.entity_id, false,
            'Added in the RTD by ' || who || ' on ' || to_char(c.created_at at time zone 'America/Chicago', 'FMMM/FMDD/YYYY'),
            'rtd', c.id::text)
    returning id into v_contact;
    insert into contact_entities (contact_id, entity_id, role, is_current, source_system, source_record_id)
    values (v_contact, c.entity_id, f ->> 'role', true, 'rtd', c.id::text);
    return jsonb_build_object('status', 'applied', 'result_ref', v_code);

  elsif c.kind = 'contact_update' then
    v_contact := (c.payload ->> 'contact_id')::uuid;
    cur := rtd__contact_values(v_contact);
    if cur is null then
      return jsonb_build_object('status', 'gone', 'message', 'That contact no longer exists.');
    end if;
    conf := rtd__conflicts(coalesce(c.base_value, c.old_value), cur);
    if conf <> '{}' and not p_force then
      return jsonb_build_object('status', 'conflict', 'fields', to_jsonb(conf), 'current', cur,
        'message', 'The CRM changed since this was proposed: ' || array_to_string(array(select replace(x, '_', ' ') from unnest(conf) x), ', '));
    end if;
    f := c.new_value;
    update contacts ct set
      first_name   = case when f ? 'first_name'   then f ->> 'first_name'   else ct.first_name end,
      last_name    = case when f ? 'last_name'    then f ->> 'last_name'    else ct.last_name end,
      title        = case when f ? 'title'        then f ->> 'title'        else ct.title end,
      email        = case when f ? 'email'        then f ->> 'email'        else ct.email end,
      phone        = case when f ? 'phone'        then f ->> 'phone'        else ct.phone end,
      mobile_phone = case when f ? 'mobile_phone' then f ->> 'mobile_phone' else ct.mobile_phone end,
      updated_at   = now()
     where ct.id = v_contact;
    select display_code into v_code from contacts where id = v_contact;
    return jsonb_build_object('status', 'applied', 'result_ref', v_code);

  elsif c.kind = 'contact_left' then
    v_contact := (c.payload ->> 'contact_id')::uuid;
    if not exists (select 1 from contacts where id = v_contact) then
      return jsonb_build_object('status', 'gone', 'message', 'That contact no longer exists.');
    end if;
    insert into contact_entities (contact_id, entity_id, is_current, ended_on, notes, source_system, source_record_id)
    values (v_contact, c.entity_id, false, (c.created_at at time zone 'America/Chicago')::date,
            'Reported gone in the RTD by ' || who || coalesce(': ' || nullif(btrim(c.payload ->> 'note'), ''), ''),
            'rtd', c.id::text)
    on conflict (contact_id, entity_id) do update
      set is_current = false,
          ended_on = coalesce(contact_entities.ended_on, excluded.ended_on),
          notes = concat_ws(E'\n', contact_entities.notes, excluded.notes);
    select display_code into v_code from contacts where id = v_contact;
    return jsonb_build_object('status', 'applied', 'result_ref', v_code);

  elsif c.kind = 'new_brand' then
    f := c.payload;
    if not p_force then
      select coalesce(jsonb_agg(m), '[]'::jsonb) into matches
        from jsonb_array_elements(find_similar_entities(f ->> 'name', 5)) m
       where (m ->> 'score')::numeric >= 0.8;
      if jsonb_array_length(matches) > 0 then
        return jsonb_build_object('status', 'duplicate', 'matches', matches,
          'message', 'This looks like a company already in the CRM.');
      end if;
    end if;
    v_code := next_display_code('entities', 'ENT');
    insert into entities (display_code, name, entity_type, website, source_system, source_record_id)
    values (v_code, f ->> 'name', 'Tenant', nullif(f ->> 'website', ''), 'rtd', c.id::text)
    returning id into v_entity;
    insert into retail_brands (entity_id, category, category_detail, size_min_sf, size_max_sf, frontage_min_ft,
                               drive_thru, facility_types, site_criteria, operating_model, expansion_status,
                               target_markets, needs_verification, last_verified_on, verification_note,
                               source_system, source_record_id)
    values (v_entity, f ->> 'category', f ->> 'category_detail', (f ->> 'size_min_sf')::numeric,
            (f ->> 'size_max_sf')::numeric, (f ->> 'frontage_min_ft')::numeric, f ->> 'drive_thru',
            coalesce(array(select jsonb_array_elements_text(f -> 'facility_types')), '{}'),
            f ->> 'site_criteria', f ->> 'operating_model', coalesce(f ->> 'expansion_status', 'unknown'),
            coalesce(array(select jsonb_array_elements_text(f -> 'target_markets')), '{}'),
            false, (c.created_at at time zone 'America/Chicago')::date, 'Added in the RTD by ' || who,
            'rtd', c.id::text);
    update rtd_changes set entity_id = v_entity where id = c.id;
    -- Anything else proposed against this pending brand (none today) would follow it.
    return jsonb_build_object('status', 'applied', 'result_ref', v_code, 'entity_id', v_entity);

  elsif c.kind in ('new_requirement', 'requirement_update') then
    return rtd__apply_requirement(c, p_force, p_link_contact_id);
  end if;

  return jsonb_build_object('status', 'gone', 'message', 'Unknown kind ' || c.kind);
end
$$;

create or replace function rtd__apply_requirement(c rtd_changes, p_force boolean, p_link_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  who text := (select display_name from rtd_users where id = c.author_id);
  f jsonb := c.payload;
  v_entity uuid;
  v_req uuid;
  v_code text;
  matches jsonb;
  cur jsonb;
  conf text[];
begin
  if c.kind = 'new_requirement' then
    v_entity := nullif(f ->> 'entity_id', '')::uuid;
    if v_entity is not null and not exists (select 1 from entities where id = v_entity) then
      return jsonb_build_object('status', 'gone', 'message', 'That company is no longer in the CRM.');
    end if;
    if v_entity is null and p_link_id is not null then
      if not exists (select 1 from entities where id = p_link_id) then
        return jsonb_build_object('status', 'gone', 'message', 'That existing company no longer exists.');
      end if;
      v_entity := p_link_id;
    end if;
    if v_entity is null and nullif(btrim(coalesce(f ->> 'party_name', '')), '') is not null then
      if not p_force then
        select coalesce(jsonb_agg(m), '[]'::jsonb) into matches
          from jsonb_array_elements(find_similar_entities(f ->> 'party_name', 5)) m
         where (m ->> 'score')::numeric >= 0.8;
        if jsonb_array_length(matches) > 0 then
          return jsonb_build_object('status', 'duplicate', 'matches', matches,
            'message', 'This looks like a company already in the CRM.');
        end if;
      end if;
      insert into entities (display_code, name, entity_type, source_system, source_record_id)
      values (next_display_code('entities', 'ENT'), btrim(f ->> 'party_name'), 'Other', 'rtd', c.id::text)
      returning id into v_entity;
    end if;

    v_code := next_display_code('requirements', 'REQ');
    insert into requirements (display_code, deal_type, property_type, size_min, size_max, budget_min, budget_max,
                              target_location, timeline, status, priority, source, confidence, source_date,
                              target_markets, rtd_shared, rtd_shared_at, rtd_note, rtd_contact,
                              source_system, source_record_id)
    values (v_code, f ->> 'deal_type', f ->> 'property_type', (f ->> 'size_min')::numeric, (f ->> 'size_max')::numeric,
            (f ->> 'budget_min')::numeric, (f ->> 'budget_max')::numeric, f ->> 'target_location', f ->> 'timeline',
            coalesce(f ->> 'status', 'active'), 'medium', 'RTD — ' || who, f ->> 'confidence',
            coalesce((f ->> 'source_date')::date, (c.created_at at time zone 'America/Chicago')::date),
            coalesce(array(select jsonb_array_elements_text(f -> 'target_markets')), '{}'),
            true, now(), f ->> 'rtd_note', f ->> 'rtd_contact', 'rtd', c.id::text)
    returning id into v_req;
    if v_entity is not null then
      insert into requirement_parties (requirement_id, entity_id) values (v_req, v_entity);
    end if;
    update rtd_changes set payload = payload || jsonb_build_object('requirement_id', v_req),
                           entity_id = coalesce(entity_id, v_entity)
     where id = c.id;
    return jsonb_build_object('status', 'applied', 'result_ref', v_code, 'requirement_id', v_req);
  end if;

  -- requirement_update
  v_req := (f ->> 'requirement_id')::uuid;
  if not exists (select 1 from requirements where id = v_req and rtd_shared) then
    return jsonb_build_object('status', 'gone', 'message', 'That requirement is no longer shared to the RTD.');
  end if;
  cur := rtd__req_values(v_req);
  conf := rtd__conflicts(coalesce(c.base_value, c.old_value), cur);
  if conf <> '{}' and not p_force then
    return jsonb_build_object('status', 'conflict', 'fields', to_jsonb(conf), 'current', cur,
      'message', 'The CRM changed since this was proposed: ' || array_to_string(array(select replace(x, '_', ' ') from unnest(conf) x), ', '));
  end if;
  f := c.new_value;
  update requirements r set
    deal_type       = case when f ? 'deal_type'       then f ->> 'deal_type'               else r.deal_type end,
    property_type   = case when f ? 'property_type'   then f ->> 'property_type'           else r.property_type end,
    size_min        = case when f ? 'size_min'        then (f ->> 'size_min')::numeric     else r.size_min end,
    size_max        = case when f ? 'size_max'        then (f ->> 'size_max')::numeric     else r.size_max end,
    budget_min      = case when f ? 'budget_min'      then (f ->> 'budget_min')::numeric   else r.budget_min end,
    budget_max      = case when f ? 'budget_max'      then (f ->> 'budget_max')::numeric   else r.budget_max end,
    target_location = case when f ? 'target_location' then f ->> 'target_location'         else r.target_location end,
    timeline        = case when f ? 'timeline'        then f ->> 'timeline'                else r.timeline end,
    status          = case when f ? 'status'          then f ->> 'status'                  else r.status end,
    confidence      = case when f ? 'confidence'      then f ->> 'confidence'              else r.confidence end,
    source_date     = case when f ? 'source_date'     then (f ->> 'source_date')::date     else r.source_date end,
    target_markets  = case when f ? 'target_markets'
                           then array(select jsonb_array_elements_text(f -> 'target_markets')) else r.target_markets end,
    rtd_note        = case when f ? 'rtd_note'        then f ->> 'rtd_note'                else r.rtd_note end,
    rtd_contact     = case when f ? 'rtd_contact'     then f ->> 'rtd_contact'             else r.rtd_contact end,
    updated_at      = now()
   where r.id = v_req;
  if f ? 'status' then
    perform rtd__sync_reconfirm(v_req);
  end if;
  select display_code into v_code from requirements where id = v_req;
  return jsonb_build_object('status', 'applied', 'result_ref', v_code, 'requirement_id', v_req);
end
$$;

create or replace function rtd_whats_new(p_days int default 30)
returns table (at timestamptz, kind text, entity_id uuid, brand text, who text, detail text, status text, requirement_id uuid)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  since timestamptz;
begin
  perform rtd_current_user();
  since := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  return query
  select * from (
    select n.created_at, 'note'::text, n.entity_id, e.name, rtd__who(n.author_id),
           left(case when n.tags <> '{}' then '[' || array_to_string(n.tags, ', ') || '] ' else '' end || n.body, 240),
           n.status, null::uuid
      from rtd_notes n join entities e on e.id = n.entity_id
     where n.created_at >= since and n.status <> 'removed'
    union all
    select c.created_at,
           case c.kind
             when 'brand_edit' then case when c.new_value ->> 'expansion_status' = 'expanding' then 'expanding' else 'edit' end
             when 'verify' then 'verified'
             when 'new_requirement' then 'requirement'
             when 'requirement_update' then 'requirement_edit'
             else c.kind end,
           coalesce(c.entity_id, case when c.kind = 'new_brand' and c.status in ('pending', 'kept') then c.id end),
           coalesce(e.name, c.payload ->> 'name', c.payload ->> 'party_name',
                                 (select pty.name from rtd__req_party((c.payload ->> 'requirement_id')::uuid) pty)), rtd__who(c.author_id),
           case c.kind
             when 'brand_edit' then 'Changed ' || (select string_agg(replace(k, '_', ' '), ', ') from jsonb_object_keys(c.new_value) k)
             when 'verify' then 'Confirmed current' || coalesce(': ' || (c.payload ->> 'note'), '')
             when 'new_contact' then 'Added ' || btrim(coalesce(c.payload ->> 'first_name', '') || ' ' || coalesce(c.payload ->> 'last_name', ''))
                                   || coalesce(', ' || (c.payload ->> 'title'), '')
             when 'contact_update' then 'Updated ' || coalesce((select btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, ''))
                                                                  from contacts ct where ct.id = (c.payload ->> 'contact_id')::uuid), 'a contact')
             when 'contact_left' then coalesce((select btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, ''))
                                                  from contacts ct where ct.id = (c.payload ->> 'contact_id')::uuid), 'A contact') || ' is no longer there'
             when 'new_brand' then 'New brand' || coalesce(' — ' || (select rc.label from retail_categories rc where rc.code = c.payload ->> 'category'), '')
             when 'new_requirement' then 'New requirement — ' || concat_ws(' · ',
                 nullif(concat_ws(' ', c.payload ->> 'deal_type', c.payload ->> 'property_type'), ''),
                 rtd__sf_range((c.payload ->> 'size_min')::numeric, (c.payload ->> 'size_max')::numeric),
                 c.payload ->> 'target_location')
             when 'requirement_update' then 'Updated ' || coalesce((select r.display_code from requirements r where r.id = (c.payload ->> 'requirement_id')::uuid), 'a requirement')
                 || ': ' || (select string_agg(replace(replace(k, 'rtd_', ''), '_', ' '), ', ') from jsonb_object_keys(c.new_value) k)
           end,
           c.status,
           case when c.kind = 'new_requirement' and c.status in ('pending', 'kept') then c.id
                else nullif(c.payload ->> 'requirement_id', '')::uuid end
      from rtd_changes c left join entities e on e.id = c.entity_id
     where c.created_at >= since and c.status <> 'undone'
    union all
    select cl.claimed_at, 'claim', cl.entity_id, e.name, rtd__who(cl.claimed_by), 'Claimed as a client', 'accepted', null::uuid
      from rtd_claims cl join entities e on e.id = cl.entity_id
     where cl.claimed_at >= since
    union all
    select cl.released_at, 'release', cl.entity_id, e.name, rtd__who(cl.released_by), 'Released the claim', 'accepted', null::uuid
      from rtd_claims cl join entities e on e.id = cl.entity_id
     where cl.released_at >= since
    union all
    -- CRM requirements Dan shared to the RTD (RTD-entered ones show through rtd_changes above).
    select r.rtd_shared_at, 'requirement', pty.entity_id, pty.name,
           (select ru.display_name from rtd_users ru where ru.is_admin order by ru.created_at limit 1),
           'Shared requirement ' || coalesce(r.display_code, '') || ' — ' || concat_ws(' · ',
             nullif(concat_ws(' ', r.deal_type, r.property_type), ''),
             rtd__sf_range(r.size_min, r.size_max),
             r.target_location),
           r.status, r.id
      from requirements r cross join lateral rtd__req_party(r.id) pty
     where r.rtd_shared and r.rtd_shared_at >= since and coalesce(r.source_system, '') <> 'rtd'
    union all
    -- Verified in the CRM itself (the connector or a CRM screen), not through the RTD.
    select (rb.last_verified_on::timestamp + time '12:00') at time zone 'America/Chicago', 'verified', rb.entity_id, e.name,
           null::text, 'Confirmed current in the CRM', 'accepted', null::uuid
      from retail_brands rb join entities e on e.id = rb.entity_id
     where rb.last_verified_on >= (since at time zone 'America/Chicago')::date
       and not rb.needs_verification
       and coalesce(rb.source_system, '') <> 'rtd'
       and not exists (select 1 from rtd_changes c where c.entity_id = rb.entity_id and c.kind = 'verify'
                         and c.status = 'accepted' and (c.created_at at time zone 'America/Chicago')::date = rb.last_verified_on)
  ) x(at, kind, entity_id, brand, who, detail, status, requirement_id)
  order by x.at desc
  limit 400;
end
$$;

create or replace function rtd_review_queue()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform rtd__require_admin();
  return coalesce((
    select jsonb_agg(item order by (item ->> 'created_at')) from (
      select jsonb_build_object(
               'type', 'note', 'id', n.id, 'kind', 'note', 'entity_id', n.entity_id, 'brand', e.name,
               'brand_code', e.display_code, 'author', rtd__who(n.author_id), 'created_at', n.created_at,
               'body', n.body, 'tags', to_jsonb(n.tags)) as item
        from rtd_notes n join entities e on e.id = n.entity_id
       where n.status = 'pending'
      union all
      select jsonb_build_object(
               'type', 'change', 'id', c.id, 'kind', c.kind, 'entity_id', c.entity_id,
               'brand', coalesce(e.name, c.payload ->> 'name', c.payload ->> 'party_name',
                                 (select pty.name from rtd__req_party((c.payload ->> 'requirement_id')::uuid) pty)),
               'brand_code', e.display_code,
               'requirement_code', (select r.display_code from requirements r where r.id = (c.payload ->> 'requirement_id')::uuid),
               'author', rtd__who(c.author_id), 'created_at', c.created_at,
               'old_value', c.old_value, 'new_value', c.new_value, 'payload', c.payload,
               'current', case when c.kind = 'brand_edit' then rtd__brand_values(c.entity_id)
                               when c.kind = 'contact_update' then rtd__contact_values((c.payload ->> 'contact_id')::uuid)
                               when c.kind = 'requirement_update' then rtd__req_values((c.payload ->> 'requirement_id')::uuid) end,
               'conflicts', case when c.kind = 'brand_edit' then to_jsonb(rtd__conflicts(coalesce(c.base_value, c.old_value), rtd__brand_values(c.entity_id)))
                                 when c.kind = 'contact_update'
                                   then to_jsonb(rtd__conflicts(coalesce(c.base_value, c.old_value), rtd__contact_values((c.payload ->> 'contact_id')::uuid)))
                                 when c.kind = 'requirement_update'
                                   then to_jsonb(rtd__conflicts(coalesce(c.base_value, c.old_value), rtd__req_values((c.payload ->> 'requirement_id')::uuid)))
                                 else '[]'::jsonb end,
               'contact_name', (select btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, ''))
                                  from contacts ct where ct.id = (c.payload ->> 'contact_id')::uuid),
               'matches', case
                 when c.kind = 'new_brand' then (
                   select coalesce(jsonb_agg(m), '[]'::jsonb)
                     from jsonb_array_elements(find_similar_entities(c.payload ->> 'name', 5)) m
                    where (m ->> 'score')::numeric >= 0.6)
                 when c.kind = 'new_contact' then (
                   select coalesce(jsonb_agg(m), '[]'::jsonb)
                     from jsonb_array_elements(find_similar_contacts(c.payload ->> 'first_name', c.payload ->> 'last_name',
                                                                     c.payload ->> 'email', 5)) m
                    where (m ->> 'score')::numeric >= 0.6)
                 when c.kind = 'new_requirement' and c.payload ->> 'entity_id' is null then (
                   select coalesce(jsonb_agg(m), '[]'::jsonb)
                     from jsonb_array_elements(find_similar_entities(c.payload ->> 'party_name', 5)) m
                    where (m ->> 'score')::numeric >= 0.6)
                 else '[]'::jsonb end) as item
        from rtd_changes c left join entities e on e.id = c.entity_id
       where c.status = 'pending'
    ) q), '[]'::jsonb);
end
$$;

-- rtd_search from 028, redefined 10/22/2026: reads brand profiles with the team's
-- RTD edits on top (rtd__effective_brands), so a size or market a colleague
-- updated is searchable at once.
create or replace function rtd_search(
  p_size            numeric default null,
  p_market          text    default null,
  p_category        text    default null,
  p_site            text    default 'any',
  p_q               text    default null,
  p_include_close   boolean default true,
  p_unverified_only boolean default false,
  p_limit           int     default 100,
  p_offset          int     default 0
)
returns table (
  entity_id          uuid,
  display_code       text,
  name               text,
  category           text,
  category_label     text,
  size_min_sf        numeric,
  size_max_sf        numeric,
  fit                text,       -- fits | close | none (no size searched)
  fit_delta_pct      int,        -- close only: + brand wants more, - brand wants less
  drive_thru         text,
  facility_types     text[],
  expansion_status   text,
  target_markets     text[],
  market_set         boolean,
  needs_verification boolean,
  last_verified_on   date,
  contact_name       text,
  contact_title      text,
  contact_email      text,
  contact_phone      text,
  contact_count      int,
  active_requirements int,
  total_count        bigint
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  perform rtd_current_user();
  if p_limit is null or p_limit < 1 then p_limit := 100; end if;
  if p_limit > 5000 then p_limit := 5000; end if;

  return query
  with b as (
    select e.id as eid, e.display_code as code, e.name as ename, rb.*,
           rc.label as cat_label,
           case
             when p_size is null then 'none'
             when rb.size_min_sf is null and rb.size_max_sf is null then 'unknown'
             when (rb.size_min_sf is null or rb.size_min_sf <= p_size)
              and (rb.size_max_sf is null or rb.size_max_sf >= p_size) then 'fits'
             when rb.size_min_sf is not null and p_size < rb.size_min_sf
              and rb.size_min_sf - p_size <= p_size * 0.15 then 'close'
             when rb.size_max_sf is not null and p_size > rb.size_max_sf
              and p_size - rb.size_max_sf <= p_size * 0.15 then 'close'
             else 'out'
           end as fit_v
      from rtd__effective_brands() rb
      join entities e on e.id = rb.entity_id
      left join retail_categories rc on rc.code = rb.category
     where (p_category is null or p_category = '' or rb.category = p_category)
       and (p_market is null or p_market = '' or rb.target_markets = '{}'
            or p_market = any (rb.target_markets))
       and (coalesce(p_site, 'any') <> 'no_drive_thru' or rb.drive_thru is distinct from 'required')
       and (not coalesce(p_unverified_only, false) or rb.needs_verification)
       and (v_q is null or e.name ilike '%' || v_q || '%' or e.trade_name ilike '%' || v_q || '%')
  ), f as (
    select * from b
     where fit_v in ('none', 'fits') or (fit_v = 'close' and coalesce(p_include_close, true))
  ), people as (
    select x.entity_id, x.contact_id, x.role, x.started_on
      from (
        select ce.entity_id, ce.contact_id, ce.role, ce.started_on
          from contact_entities ce join f on f.eid = ce.entity_id
         where ce.is_current
        union
        select c.entity_id, c.id, null::text, null::date
          from contacts c join f on f.eid = c.entity_id
         where not exists (select 1 from contact_entities x2
                            where x2.contact_id = c.id and x2.entity_id = c.entity_id and not x2.is_current)
      ) x
  ), best as (
    select distinct on (p.entity_id) p.entity_id, c.first_name, c.last_name, c.title, c.email,
           coalesce(c.phone, c.mobile_phone) as phone
      from people p join contacts c on c.id = p.contact_id
     order by p.entity_id,
              (coalesce(p.role, '') = 'Tenant Rep Broker'),
              (c.email is null),
              p.started_on desc nulls last,
              c.last_name
  )
  select f.eid, f.code, f.ename, f.category, f.cat_label, f.size_min_sf, f.size_max_sf,
         case when f.fit_v = 'none' then 'none' else f.fit_v end,
         case when f.fit_v <> 'close' then null
              when p_size < f.size_min_sf then round((f.size_min_sf - p_size) / p_size * 100)::int
              else -round((p_size - f.size_max_sf) / p_size * 100)::int end,
         f.drive_thru, f.facility_types, f.expansion_status, f.target_markets,
         f.target_markets <> '{}', f.needs_verification, f.last_verified_on,
         nullif(btrim(coalesce(bt.first_name, '') || ' ' || coalesce(bt.last_name, '')), ''),
         bt.title, bt.email, bt.phone,
         (select count(distinct p2.contact_id) from people p2 where p2.entity_id = f.eid)::int,
         (select count(*) from requirement_parties rp join requirements r on r.id = rp.requirement_id
           where rp.entity_id = f.eid and r.status = 'active')::int,
         count(*) over ()
    from f
    left join best bt on bt.entity_id = f.eid
   order by case f.fit_v when 'fits' then 0 when 'close' then 1 else 2 end,
            f.needs_verification,
            f.last_verified_on desc nulls last,
            f.ename
   limit p_limit offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- ===========================================================================
-- 9. Grants
-- ===========================================================================
revoke execute on function rtd_undo(uuid)          from public, anon;
revoke execute on function rtd_remove_note(uuid)   from public, anon;
revoke execute on function rtd_new_brand(uuid)     from public, anon;
revoke execute on function rtd_new_brands()        from public, anon;
revoke execute on function rtd_requirements(text, text, text, text, numeric, text, int, int) from public, anon;
grant execute on function rtd_undo(uuid)           to authenticated;
grant execute on function rtd_remove_note(uuid)    to authenticated;
grant execute on function rtd_new_brand(uuid)      to authenticated;
grant execute on function rtd_new_brands()         to authenticated;
grant execute on function rtd_requirements(text, text, text, text, numeric, text, int, int) to authenticated;
-- Redefined above; restate so a fresh database matches production.
revoke execute on function rtd_brand(uuid), rtd_brand_activity(uuid), rtd_requirement(uuid),
  rtd_review(text, uuid, text, boolean, uuid, text), rtd_review_queue(), rtd_whats_new(int),
  rtd_propose_edit(uuid, jsonb), rtd_update_contact(uuid, uuid, jsonb), rtd_mark_verified(uuid, text),
  rtd_update_requirement(uuid, jsonb),
  rtd_search(numeric, text, text, text, text, boolean, boolean, int, int) from public, anon;
grant execute on function rtd_brand(uuid), rtd_brand_activity(uuid), rtd_requirement(uuid),
  rtd_review(text, uuid, text, boolean, uuid, text), rtd_review_queue(), rtd_whats_new(int),
  rtd_propose_edit(uuid, jsonb), rtd_update_contact(uuid, uuid, jsonb), rtd_mark_verified(uuid, text),
  rtd_update_requirement(uuid, jsonb),
  rtd_search(numeric, text, text, text, text, boolean, boolean, int, int) to authenticated;
revoke execute on function rtd__apply(uuid, boolean, uuid), rtd__apply_requirement(rtd_changes, boolean, uuid)
  from public, anon, authenticated;

commit;
