import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

const CONFIDENCE_LEVELS = [
  "confirmed",
  "broker_reported",
  "market_estimate",
  "rumor",
];

// GET /api/agent/lease-comps?limit=50 — list lease comps, most recent lease first.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  const { data, error } = await supabase
    .from("lease_comps")
    .select("*")
    .order("lease_date", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lease_comps: data });
}

// POST /api/agent/lease-comps — create a lease comp.
// Body: { property_address, property_id?, tenant?, landlord?, lease_date?,
//         sf?, asking_rent?, final_rent?, lease_term_months?, ti_allowance?,
//         free_rent_months?, property_type?, confidence_level? ("confirmed" |
//         "broker_reported" | "market_estimate" | "rumor" — defaults to
//         "broker_reported"), source?, why_it_matters?, notes? }
// Mirrors app/lease-comps/actions.ts:createLeaseComp field-for-field.
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
  const tenant = String(body.tenant || "").trim() || null;
  const landlord = String(body.landlord || "").trim() || null;
  const lease_date = body.lease_date ? String(body.lease_date) : null;
  const sf_raw = String(body.sf ?? "").trim();
  const asking_rent_raw = String(body.asking_rent ?? "").trim();
  const final_rent_raw = String(body.final_rent ?? "").trim();
  const lease_term_months_raw = String(body.lease_term_months ?? "").trim();
  const ti_allowance_raw = String(body.ti_allowance ?? "").trim();
  const free_rent_months_raw = String(body.free_rent_months ?? "").trim();
  const property_type = String(body.property_type || "").trim() || null;
  const confidence_level_raw = String(body.confidence_level || "").trim();
  const confidence_level = CONFIDENCE_LEVELS.includes(confidence_level_raw)
    ? confidence_level_raw
    : "broker_reported";
  const source = String(body.source || "").trim() || null;
  const why_it_matters = String(body.why_it_matters || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;

  const { data, error } = await supabase
    .from("lease_comps")
    .insert({
      property_address,
      property_id,
      tenant,
      landlord,
      lease_date,
      sf: sf_raw ? Number(sf_raw) : null,
      asking_rent: asking_rent_raw ? Number(asking_rent_raw) : null,
      final_rent: final_rent_raw ? Number(final_rent_raw) : null,
      lease_term_months: lease_term_months_raw
        ? Number(lease_term_months_raw)
        : null,
      ti_allowance: ti_allowance_raw ? Number(ti_allowance_raw) : null,
      free_rent_months: free_rent_months_raw
        ? Number(free_rent_months_raw)
        : null,
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

  return NextResponse.json({ lease_comp: data }, { status: 201 });
}
