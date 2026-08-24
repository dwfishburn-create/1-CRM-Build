import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// GET /api/agent/owners?limit=50 — list owners/entities, most recent first.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  const { data, error } = await supabase
    .from("owners")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ owners: data });
}

// POST /api/agent/owners — create an owner/entity.
// Body: { name, entity_type?, primary_contact_id?, notes? }
// Mirrors app/owners/actions.ts:createOwner field-for-field.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json(
      { error: "Owner / entity name is required." },
      { status: 400 }
    );
  }

  const entity_type = String(body.entity_type || "").trim() || null;
  const primary_contact_id_raw = String(body.primary_contact_id || "").trim();
  const primary_contact_id = primary_contact_id_raw || null;
  const notes = String(body.notes || "").trim() || null;

  const display_code = await nextDisplayCode("owners", "OWN");

  const { data, error } = await supabase
    .from("owners")
    .insert({
      display_code,
      name,
      entity_type,
      primary_contact_id,
      notes,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ owner: data }, { status: 201 });
}
