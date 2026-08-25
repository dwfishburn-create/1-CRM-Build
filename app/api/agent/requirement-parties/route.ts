import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/agent/requirement-parties?limit=50 — list requirement<->party
// links, most recent first. Optional ?requirement_id= filters to one
// requirement.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;
  const requirementId = request.nextUrl.searchParams.get("requirement_id");

  let query = supabase
    .from("requirement_parties")
    .select(
      "*, requirement:requirements(display_code, deal_type), contact:contacts!contact_id(display_code, first_name, last_name), entity:entities!entity_id(display_code, name)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (requirementId) {
    query = query.eq("requirement_id", requirementId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requirement_parties: data });
}

// POST /api/agent/requirement-parties — link a contact and/or an entity to a
// requirement. A single requirement can attach to any combination of
// contacts and entities at once — e.g. a decision-maker personally AND the
// company itself — so call this once per party to link.
// Body: { requirement_id, contact_id?, entity_id? } — at least one of
// contact_id/entity_id is required.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const requirement_id = String(body.requirement_id || "").trim();
  const contact_id = body.contact_id ? String(body.contact_id).trim() : null;
  const entity_id = body.entity_id ? String(body.entity_id).trim() : null;

  if (!requirement_id) {
    return NextResponse.json(
      { error: "requirement_id is required." },
      { status: 400 }
    );
  }
  if (!contact_id && !entity_id) {
    return NextResponse.json(
      { error: "At least one of contact_id or entity_id is required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("requirement_parties")
    .insert({ requirement_id, contact_id, entity_id })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requirement_party: data }, { status: 201 });
}
