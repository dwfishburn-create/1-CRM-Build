import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";
import { parseListParams, resolveSelect } from "@/lib/listQuery";
import {
  findNearMatches,
  blockingMatches,
  duplicateBlockResponse,
} from "@/lib/nearMatch";

const ENTITY_COLUMNS = [
  "id",
  "display_code",
  "name",
  "trade_name",
  "entity_type",
  "industry",
  "website",
  "primary_contact_id",
  "notes",
  "created_at",
  "updated_at",
] as const;

const ALIAS_EMBED = "aliases:entity_aliases(id, alias, source, note)";

const ENTITY_SELECTS = {
  summary:
    "id, display_code, name, trade_name, entity_type, industry, website, " +
    `primary_contact_id, ${ALIAS_EMBED}`,
  full: `*, ${ALIAS_EMBED}`,
};

function coerceBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

// GET /api/agent/entities — list or search entities, most recent first.
// Entities replaces the old separate Owners + Companies tables.
//
// Query params: search, fields ("summary" | "full" | column list), limit
// (default 25, max 100), offset. Returns
// { entities, count, limit, offset, has_more }.
//
// Search is matched against the search_text generated column from migration
// 014 (name + trade_name + industry), one chained ilike per whitespace-
// separated token, so tokens are ANDed. trade_name is in there because d/b/a
// names are frequently what a search actually knows — Hibbett Sports and
// Dollar Tree on the Lexington rent roll are trade names, not legal ones.
//
// Extended 9/15/2026 alongside the contacts rewrite. Entities were on the
// same curve as contacts in finding #1 of CRM_Findings_2026-09-15_BR-HyVee.md
// (54 rows, same absent lookup, same unbounded response) and would have hit
// the same wall a little later.
export async function GET(request: NextRequest) {
  const params = parseListParams(request.nextUrl.searchParams);

  const resolved = resolveSelect(params.fields, ENTITY_SELECTS, ENTITY_COLUMNS);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  let query = supabase
    .from("entities")
    .select(resolved.select, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);

  for (const term of params.terms) {
    query = query.ilike("search_text", `%${term}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    entities: data,
    count: count ?? null,
    limit: params.limit,
    offset: params.offset,
    has_more: count === null ? false : params.offset + (data?.length ?? 0) < count,
  });
}

// POST /api/agent/entities — create an entity.
// Body: { name, trade_name?, entity_type?, industry?, website?,
//         primary_contact_id?, notes?, aliases?, allow_duplicate? }
// Mirrors app/entities/actions.ts:createEntity field-for-field, plus aliases.
//
// Duplicate check added 9/24/2026 (migration 016). Entities were the worst
// case in the CRM: no alias list, no near-match check, and no merge at all —
// list_entities' own description said a duplicate entity "becomes permanent."
// This route now runs find_similar_entities first and REFUSES with 409 on a
// match at or above the block threshold. Matching is on the normalized name
// (punctuation and LLC/Inc/Corp/Trust stripped) plus the alias list, so
// "Ashley Lynn's Inc." and "Ashley Lynns Inc" collide, and so do "TitleCore,
// LLC" and "TitleCore National" — the pair that actually happened on
// 9/14/2026. allow_duplicate: true overrides.
//
// aliases: optional array of other names this company is known by (the name on
// the lease, the assessor's spelling, a d/b/a). Written to entity_aliases,
// which feeds the same search_text the lookup uses, so a future search for any
// of them finds this one record instead of creating a second.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Entity name is required." }, { status: 400 });
  }

  const trade_name = String(body.trade_name || "").trim() || null;
  const entity_type = String(body.entity_type || "").trim() || null;
  const industry = String(body.industry || "").trim() || null;
  const website = String(body.website || "").trim() || null;
  const primary_contact_id = String(body.primary_contact_id || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;

  const aliases = Array.isArray(body.aliases)
    ? (body.aliases as unknown[])
        .map((a) => String(a ?? "").trim())
        .filter(Boolean)
    : [];

  const allow_duplicate = coerceBoolean(body.allow_duplicate);
  let possible_duplicates: unknown[] = [];
  let duplicate_check: string | null = null;

  const near = await findNearMatches("find_similar_entities", {
    p_name: name,
    p_limit: 5,
  });

  if (!near.ok) {
    duplicate_check = `not run: ${near.error}`;
  } else {
    possible_duplicates = near.candidates;
    const blocking = blockingMatches(near.candidates);
    if (blocking.length > 0 && !allow_duplicate) {
      return duplicateBlockResponse("entity", blocking);
    }
    if (blocking.length > 0) {
      duplicate_check = "overridden by allow_duplicate";
    }
  }

  const display_code = await nextDisplayCode("entities", "ENT");

  const { data, error } = await supabase
    .from("entities")
    .insert({
      display_code,
      name,
      trade_name,
      entity_type,
      industry,
      website,
      primary_contact_id,
      notes,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (aliases.length > 0) {
    const { error: aliasError } = await supabase.from("entity_aliases").insert(
      aliases.map((alias) => ({
        entity_id: data.id,
        alias,
        source: "create",
      }))
    );
    // An alias that fails to save is worth reporting but not worth failing the
    // create over — the entity itself is already in.
    if (aliasError) {
      return NextResponse.json(
        {
          entity: data,
          alias_warning: `Entity created, but its aliases were not saved: ${aliasError.message}`,
          ...(possible_duplicates.length > 0 ? { possible_duplicates } : {}),
        },
        { status: 201 }
      );
    }
  }

  return NextResponse.json(
    {
      entity: data,
      ...(aliases.length > 0 ? { aliases } : {}),
      ...(possible_duplicates.length > 0 ? { possible_duplicates } : {}),
      ...(duplicate_check ? { duplicate_check } : {}),
    },
    { status: 201 }
  );
}

// PATCH /api/agent/entities — update one or more fields on an existing
// entity. Body: { id, ...fields }. Only the fields actually present in the
// body are written — an omitted field is left untouched; a field sent as
// an empty string clears it to null (e.g. primary_contact_id: "" to
// unlink). Editable fields: name, entity_type, industry, website,
// primary_contact_id, notes. display_code is never editable. At least one
// field besides id is required.
//
// Added 9/2/2026, same pattern/motivation as update_contact (9/1/2026) and
// the update_property extension (9/2/2026) — a spelling correction like
// the 8/31/2026 Astlali Concina->Cocina fix needed raw SQL because no
// update path existed for entities. See CRM_Requirements_and_Decisions_Log.md.
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = String(body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const editableFields = [
    "name",
    "trade_name",
    "entity_type",
    "industry",
    "website",
    "primary_contact_id",
    "notes",
  ] as const;

  const updatePayload: Record<string, unknown> = {};
  for (const field of editableFields) {
    if (field in body) {
      const value = String(body[field] ?? "").trim();
      updatePayload[field] = value || null;
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json(
      {
        error:
          "Provide at least one field to update: " + editableFields.join(", ") + ".",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("entities")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entity: data });
}

// DELETE /api/agent/entities?id=<uuid>&force=true — remove an entity.
//
// Added 9/24/2026, the mirror of the contacts DELETE added 9/15/2026, and for
// the same reason: without it an entity created in error is permanent.
//
// Refuses by default when anything still references the entity and returns the
// breakdown, because for a duplicate the right operation is merge_entities —
// delete destroys the links (property ownership, tenancies, contacts'
// employer, project roles) while merge moves them.
//
// Two link types are refused even with force, the same shape as contacts:
// leases and property_tenant each require at least one of (entity, contact)
// and their entity FKs are ON DELETE SET NULL, so deleting the only party on
// such a row nulls the column and then fails the check constraint.
export async function DELETE(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json(
      { error: "id is required, as a query parameter: ?id=<uuid>" },
      { status: 400 }
    );
  }

  const force = coerceBoolean(request.nextUrl.searchParams.get("force"));

  const { data: entity, error: findError } = await supabase
    .from("entities")
    .select("id, display_code, name, trade_name")
    .eq("id", id)
    .maybeSingle();

  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }
  if (!entity) {
    return NextResponse.json({ error: `No entity with id ${id}.` }, { status: 404 });
  }

  const { data: links, error: linkError } = await supabase.rpc("entity_link_counts", {
    p_id: id,
  });

  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  const counts = (links ?? {}) as Record<string, unknown>;
  const soleParty = (counts.sole_party_blocks ?? {}) as Record<string, number>;

  // Aliases are this entity's own rows, not references from elsewhere — they
  // cascade with it and are not a reason to refuse.
  const linked = Object.entries(counts)
    .filter(
      ([key, value]) =>
        key !== "sole_party_blocks" && key !== "aliases" && Number(value) > 0
    )
    .map(([key, value]) => `${key}: ${value}`);

  const hardBlocks = Object.entries(soleParty)
    .filter(([, value]) => Number(value) > 0)
    .map(([key, value]) => `${key}: ${value}`);

  if (hardBlocks.length > 0) {
    return NextResponse.json(
      {
        error:
          "Refused: this entity is the only party on a lease or tenancy row, " +
          "and those rows require at least one of (entity, contact). Deleting " +
          "would violate that constraint. Attach a contact to those rows, or " +
          "merge this entity into another, first.",
        blocking: hardBlocks,
        links: counts,
        entity,
      },
      { status: 409 }
    );
  }

  if (linked.length > 0 && !force) {
    return NextResponse.json(
      {
        error:
          `Refused: ${linked.length} table(s) still reference this entity. ` +
          "If this is a duplicate, use merge_entities (POST /api/agent/entities/merge) " +
          "so the links move to the surviving record instead of being destroyed. " +
          "If deletion really is right, repeat with force=true.",
        links: counts,
        entity,
      },
      { status: 409 }
    );
  }

  const { error: deleteError } = await supabase.from("entities").delete().eq("id", id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    deleted: true,
    entity,
    links_destroyed: linked.length > 0 ? counts : null,
  });
}
