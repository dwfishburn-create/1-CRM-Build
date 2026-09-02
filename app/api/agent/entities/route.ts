import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// GET /api/agent/entities?limit=50 — list entities, most recent first.
// Entities replaces the old separate Owners + Companies tables.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  const { data, error } = await supabase
    .from("entities")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entities: data });
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
