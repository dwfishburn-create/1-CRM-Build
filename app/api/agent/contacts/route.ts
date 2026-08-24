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
    .select("*, entity:entities(id, display_code, name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contacts: data });
}

// POST /api/agent/contacts — create a contact.
// Body: { first_name?, last_name?, email?, phone?, mobile_phone?, title?,
//         company_name?, notes? }
// Mirrors app/contacts/actions.ts:createContact field-for-field.
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
  const company_name = String(body.company_name || "").trim();
  const notes = String(body.notes || "").trim() || null;

  if (!first_name && !last_name) {
    return NextResponse.json(
      { error: "First or last name is required." },
      { status: 400 }
    );
  }

  let entity_id: string | null = null;
  if (company_name) {
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
