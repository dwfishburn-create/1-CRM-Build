import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/agent/property-tenants?limit=50 — list tenancy links, most recent first.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  const { data, error } = await supabase
    .from("property_tenant")
    .select(
      "*, property:properties(display_code, address, suite_number), entity:entities(display_code, name), contact:contacts(display_code, first_name, last_name)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ property_tenants: data });
}

// POST /api/agent/property-tenants — link an entity and/or contact as
// tenant of a property (usually a space). At least one of entity_id /
// contact_id is required.
// Body: { property_id, entity_id?, contact_id?, lease_start_date?,
//         lease_end_date?, is_current?, is_headquarters?, notes? }
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const property_id = String(body.property_id || "").trim();
  const entity_id = String(body.entity_id || "").trim() || null;
  const contact_id = String(body.contact_id || "").trim() || null;

  if (!property_id) {
    return NextResponse.json({ error: "property_id is required." }, { status: 400 });
  }
  if (!entity_id && !contact_id) {
    return NextResponse.json(
      { error: "At least one of entity_id or contact_id is required." },
      { status: 400 }
    );
  }

  const lease_start_date = body.lease_start_date ? String(body.lease_start_date) : null;
  const lease_end_date = body.lease_end_date ? String(body.lease_end_date) : null;
  const is_current = body.is_current === undefined ? true : Boolean(body.is_current);
  const is_headquarters = Boolean(body.is_headquarters);
  const notes = String(body.notes || "").trim() || null;

  const { data, error } = await supabase
    .from("property_tenant")
    .insert({
      property_id,
      entity_id,
      contact_id,
      lease_start_date,
      lease_end_date,
      is_current,
      is_headquarters,
      notes,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ property_tenant: data }, { status: 201 });
}
