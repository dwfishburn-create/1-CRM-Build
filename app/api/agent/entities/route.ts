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
