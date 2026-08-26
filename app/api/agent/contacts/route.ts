import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// GET /api/agent/contacts?limit=50 — list contacts, most recent first.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  const { data, error } = await supabase
    .from("contacts")
    .select("*, entity:entities!entity_id(id, display_code, name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contacts: data });
}

// POST /api/agent/contacts — create a contact.
// Body: { first_name?, last_name?, email?, phone?, mobile_phone?, title?,
//         entity_id?, company_name?, notes? }
// entity_id: link directly to an existing entities row when the caller
// already has its id (e.g. from a prior /api/agent/entities call) — this is
// the preferred way to link, and skips the lookup-or-create below entirely.
// company_name: fallback for callers that only know a name, not an id —
// looks up an existing entity by name (case-insensitive) or creates one.
// If both are provided, entity_id wins and company_name is ignored.
// Mirrors app/contacts/actions.ts:createContact field-for-field, plus
// entity_id which that form doesn't expose yet.
//
// Bug fixed 8/26/2026: previously this route silently ignored a bare
// entity_id in the body (only company_name was ever read), so a caller
// linking a contact by id got no error and no link — the row just saved
// with entity_id: null. See CRM_Requirements_and_Decisions_Log.md.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const first_name = String(body.first_name || "").trim();
  const last_name = String(body.last_name || "").trim();
  const email = String(body.email || "").trim() || null;
  const phone = String(body.phone || "").trim() || null;
  const mobile_phone = String(body.mobile_phone || "").trim() || null;
  const title = String(body.title || "").trim() || null;
  const entity_id_input = String(body.entity_id || "").trim();
  const company_name = String(body.company_name || "").trim();
  const notes = String(body.notes || "").trim() || null;

  if (!first_name && !last_name) {
    return NextResponse.json(
      { error: "First or last name is required." },
      { status: 400 }
    );
  }

  let entity_id: string | null = null;
  if (entity_id_input) {
    entity_id = entity_id_input;
  } else if (company_name) {
    const { data: existing, error: lookupError } = await supabase
      .from("entities")
      .select("id")
      .ilike("name", company_name)
      .maybeSingle();
    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 500 });
    }

    if (existing) {
      entity_id = existing.id;
    } else {
      const entityCode = await nextDisplayCode("entities", "ENT");
      const { data: newEntity, error: entityError } = await supabase
        .from("entities")
        .insert({ name: company_name, display_code: entityCode })
        .select("id")
        .single();
      if (entityError) {
        return NextResponse.json(
          { error: entityError.message },
          { status: 500 }
        );
      }
      entity_id = newEntity.id;
    }
  }

  const display_code = await nextDisplayCode("contacts", "CON");

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      display_code,
      first_name: first_name || null,
      last_name: last_name || null,
      email,
      phone,
      mobile_phone,
      title,
      entity_id,
      notes,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contact: data }, { status: 201 });
}
