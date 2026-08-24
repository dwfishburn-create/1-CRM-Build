import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// GET /api/agent/properties?limit=50 — list properties, most recent first.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ properties: data });
}

// POST /api/agent/properties — create a property.
// Body: { address, city?, state?, zip?, property_type?, submarket?,
//         building_sf?, land_acres?, notes? }
// Mirrors app/properties/actions.ts:createProperty field-for-field.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const address = String(body.address || "").trim();
  if (!address) {
    return NextResponse.json({ error: "Address is required." }, { status: 400 });
  }

  const city = String(body.city || "").trim() || null;
  const state = String(body.state || "").trim() || "NE";
  const zip = String(body.zip || "").trim() || null;
  const property_type = String(body.property_type || "").trim() || null;
  const submarket = String(body.submarket || "").trim() || null;
  const building_sf_raw = String(body.building_sf ?? "").trim();
  const land_acres_raw = String(body.land_acres ?? "").trim();
  const notes = String(body.notes || "").trim() || null;

  const display_code = await nextDisplayCode("properties", "PROP");

  const { data, error } = await supabase
    .from("properties")
    .insert({
      display_code,
      address,
      city,
      state,
      zip,
      property_type,
      submarket,
      building_sf: building_sf_raw ? Number(building_sf_raw) : null,
      land_acres: land_acres_raw ? Number(land_acres_raw) : null,
      notes,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ property: data }, { status: 201 });
}
