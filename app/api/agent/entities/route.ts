import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";
import { parseListParams, resolveSelect } from "@/lib/listQuery";

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

const ENTITY_SELECTS = {
  summary:
    "id, display_code, name, trade_name, entity_type, industry, website, primary_contact_id",
  full: "*",
};

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
// Body: { name, entity_type?, industry?, website?, primary_contact_id?, notes? }
// Mirrors app/entities/actions.ts:createEntity field-for-field.
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

  const entity_type = String(body.entity_type || "").trim() || null;
  const industry = String(body.industry || "").trim() || null;
  const website = String(body.website || "").trim() || null;
  const primary_contact_id = String(body.primary_contact_id || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;

  const display_code = await nextDisplayCode("entities", "ENT");

  const { data, error } = await supabase
    .from("entities")
    .insert({
      display_code,
      name,
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

  return NextResponse.json({ entity: data }, { status: 201 });
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
