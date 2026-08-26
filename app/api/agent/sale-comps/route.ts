import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

const CONFIDENCE_LEVELS = [
  "confirmed",
  "broker_reported",
  "market_estimate",
  "rumor",
];

// GET /api/agent/sale-comps?limit=50 — list sale comps, most recent sale first.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  const { data, error } = await supabase
    .from("sale_comps")
    .select("*")
    .order("sale_date", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sale_comps: data });
}

// POST /api/agent/sale-comps — create a sale comp.
// Body: { property_address, property_id?, sale_date?, sale_price?, buyer?,
//         seller?, building_sf?, land_acres?, cap_rate?, property_type?,
//         confidence_level? ("confirmed" | "broker_reported" |
//         "market_estimate" | "rumor" — defaults to "broker_reported"),
//         source?, why_it_matters?, notes? }
// price_per_sf is a generated column (sale_price / building_sf) — do not
// send it. Mirrors app/sale-comps/actions.ts:createSaleComp field-for-field.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const property_address = String(body.property_address || "").trim();
  if (!property_address) {
    return NextResponse.json(
      { error: "property_address is required." },
      { status: 400 }
    );
  }

  const property_id = String(body.property_id || "").trim() || null;
  const sale_date = body.sale_date ? String(body.sale_date) : null;
  const sale_price_raw = String(body.sale_price ?? "").trim();
  const buyer = String(body.buyer || "").trim() || null;
  const seller = String(body.seller || "").trim() || null;
  const building_sf_raw = String(body.building_sf ?? "").trim();
  const land_acres_raw = String(body.land_acres ?? "").trim();
  const cap_rate_raw = String(body.cap_rate ?? "").trim();
  const property_type = String(body.property_type || "").trim() || null;
  const confidence_level_raw = String(body.confidence_level || "").trim();
  const confidence_level = CONFIDENCE_LEVELS.includes(confidence_level_raw)
    ? confidence_level_raw
    : "broker_reported";
  const source = String(body.source || "").trim() || null;
  const why_it_matters = String(body.why_it_matters || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;

  const { data, error } = await supabase
    .from("sale_comps")
    .insert({
      property_address,
      property_id,
      sale_date,
      sale_price: sale_price_raw ? Number(sale_price_raw) : null,
      buyer,
      seller,
      building_sf: building_sf_raw ? Number(building_sf_raw) : null,
      land_acres: land_acres_raw ? Number(land_acres_raw) : null,
      cap_rate: cap_rate_raw ? Number(cap_rate_raw) : null,
      property_type,
      confidence_level,
      source,
      why_it_matters,
      notes,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sale_comp: data }, { status: 201 });
}
