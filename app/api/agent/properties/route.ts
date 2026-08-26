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

// POST /api/agent/properties — create a property (or a space within one).
// Body: { address, city?, state?, zip?, property_type?, submarket?,
//         building_sf?, land_acres?, parent_property_id?, suite_number?,
//         market_status?, research_status?, notes? }
// parent_property_id: omit/null for a standalone building/parcel; set it to
// the parent property's id to create a leasable space/suite inside it (its
// own address + suite_number, distinct from the parent's own address).
// market_status / research_status: omit to let the DB apply its own column
// default (market_status -> off_market, research_status -> unresearched).
// An invalid value is rejected by the DB's own check constraint rather than
// validated here.
// Mirrors app/properties/actions.ts:createProperty field-for-field, plus
// market_status/research_status which that form doesn't expose yet.
//
// Bug fixed 8/26/2026: previously this route never read market_status (or
// research_status) from the body at all, so any value a caller sent was
// silently discarded and every row landed on the DB default regardless —
// no error, it just looked like the field had been ignored. See
// CRM_Requirements_and_Decisions_Log.md.
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
  const parent_property_id = String(body.parent_property_id || "").trim() || null;
  const suite_number = String(body.suite_number || "").trim() || null;
  const market_status = String(body.market_status || "").trim();
  const research_status = String(body.research_status || "").trim();
  const notes = String(body.notes || "").trim() || null;

  const display_code = await nextDisplayCode("properties", "PROP");

  const insertPayload: Record<string, unknown> = {
    display_code,
    address,
    city,
    state,
    zip,
    property_type,
    submarket,
    building_sf: building_sf_raw ? Number(building_sf_raw) : null,
    land_acres: land_acres_raw ? Number(land_acres_raw) : null,
    parent_property_id,
    suite_number,
    notes,
  };
  // Only set these keys when the caller actually provided a value, so an
  // omitted field falls through to the column's DB default instead of
  // being explicitly overwritten with NULL.
  if (market_status) insertPayload.market_status = market_status;
  if (research_status) insertPayload.research_status = research_status;

  const { data, error } = await supabase
    .from("properties")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ property: data }, { status: 201 });
}
