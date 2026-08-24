import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/agent/property-owners?limit=50 — list ownership links, most recent first.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  const { data, error } = await supabase
    .from("property_owner")
    .select(
      "*, property:properties(display_code, address), entity:entities(display_code, name)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ property_owners: data });
}

// POST /api/agent/property-owners — link an entity as owner of a property.
// Body: { property_id, entity_id, ownership_start_date?, ownership_end_date?,
//         is_current?, is_headquarters? }
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const property_id = String(body.property_id || "").trim();
  const entity_id = String(body.entity_id || "").trim();
  if (!property_id || !entity_id) {
    return NextResponse.json(
      { error: "property_id and entity_id are both required." },
      { status: 400 }
    );
  }

  const ownership_start_date = body.ownership_start_date
    ? String(body.ownership_start_date)
    : null;
  const ownership_end_date = body.ownership_end_date
    ? String(body.ownership_end_date)
    : null;
  const is_current = body.is_current === undefined ? true : Boolean(body.is_current);
  const is_headquarters = Boolean(body.is_headquarters);

  const { data, error } = await supabase
    .from("property_owner")
    .insert({
      property_id,
      entity_id,
      ownership_start_date,
      ownership_end_date,
      is_current,
      is_headquarters,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ property_owner: data }, { status: 201 });
}
