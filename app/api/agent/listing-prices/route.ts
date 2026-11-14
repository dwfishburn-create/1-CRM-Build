import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// Listing price history (migration 036, Phase 3 of Retail Listing Intake).
//
// GET  /api/agent/listing-prices?property_id=<uuid>
//        → { history: [...oldest first], summary: [...one per listing_type] }
// GET  /api/agent/listing-prices?changed_since=YYYY-MM-DD&limit=50
//        → { listings: [...summary rows observed since the date, newest first] }
//        (no params: the most recently observed listings)
// POST /api/agent/listing-prices — record one observation of a listing's terms.
//   Body: { property_id, listing_type?: sale|lease|sublease|land,
//           status?: active|price_change|under_contract|sold|leased|withdrawn|expired|relisted,
//           asking_price?, asking_rate?, rate_basis?, sf?, listing_broker?, listing_firm?,
//           is_cbre?, is_dan_listing?, observed_on?, source?, source_ref?, notes?,
//           cap_rate? (%), noi?, tenancy_type?, tenant_credit?, term_remaining_years?,
//           land_acres?  (investment facts, migration 037),
//           update_market_status? (default true) }
//   Also moves properties.market_status to match (on_market / sold / leased /
//   off_market) unless update_market_status is false, and returns the
//   property's current owners with their do_not_solicit flags so the caller
//   knows whether owner outreach is allowed.

const LISTING_TYPES = ["sale", "lease", "sublease", "land"];
const TENANCY = ["single_tenant_nnn", "multi_tenant", "vacant", "value_add", "owner_user", "ground_lease"];
const CREDIT = ["investment_grade", "national", "regional", "local"];
const STATUSES = ["active", "price_change", "under_contract", "sold", "leased", "withdrawn", "expired", "relisted"];

function marketStatusFor(status: string): string {
  if (status === "sold") return "sold";
  if (status === "leased") return "leased";
  if (status === "withdrawn" || status === "expired") return "off_market";
  return "on_market";
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const propertyId = sp.get("property_id");

  if (propertyId) {
    const [hist, summ] = await Promise.all([
      supabase
        .from("listing_price_history")
        .select("*")
        .eq("property_id", propertyId)
        .order("observed_on", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase.from("listing_price_summary").select("*").eq("property_id", propertyId),
    ]);
    const err = hist.error ?? summ.error;
    if (err) return NextResponse.json({ error: err.message }, { status: 500 });
    return NextResponse.json({ history: hist.data, summary: summ.data });
  }

  const limit = Math.min(Number(sp.get("limit")) || 50, 200);
  let q = supabase
    .from("listing_price_summary")
    .select("*, property:properties!property_id(display_code, address, city, property_type, building_sf)")
    .order("last_observed_on", { ascending: false })
    .limit(limit);
  const since = sp.get("changed_since");
  if (since) q = q.gte("last_observed_on", since);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ listings: data });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const property_id = String(body.property_id || "").trim();
  if (!property_id) return NextResponse.json({ error: "property_id is required." }, { status: 400 });

  const listing_type = String(body.listing_type || "sale").trim().toLowerCase();
  if (!LISTING_TYPES.includes(listing_type)) {
    return NextResponse.json({ error: `listing_type must be one of ${LISTING_TYPES.join(", ")}.` }, { status: 400 });
  }
  const status = String(body.status || "active").trim().toLowerCase();
  if (!STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}.` }, { status: 400 });
  }

  const asking_price = num(body.asking_price);
  const asking_rate = num(body.asking_rate);
  const sf = num(body.sf);
  // 11/14/2026 (migration 037): investment facts from the flyer/OM.
  let cap_rate = num(body.cap_rate);
  if (cap_rate !== null && cap_rate > 0 && cap_rate < 1) cap_rate = Math.round(cap_rate * 10000) / 100; // 0.07 → 7
  const noi = num(body.noi);
  const term_remaining_years = num(body.term_remaining_years);
  const land_acres = num(body.land_acres);
  for (const [k, v] of Object.entries({ asking_price, asking_rate, sf, cap_rate, noi, term_remaining_years, land_acres })) {
    if (Number.isNaN(v)) return NextResponse.json({ error: `${k} must be a number.` }, { status: 400 });
  }

  const observed_on = String(body.observed_on || "").trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observed_on)) {
    return NextResponse.json({ error: "observed_on must be YYYY-MM-DD." }, { status: 400 });
  }

  const text = (k: string) => String(body[k] ?? "").trim() || null;
  const tenancy_type = text("tenancy_type")?.toLowerCase() ?? null;
  if (tenancy_type && !TENANCY.includes(tenancy_type)) {
    return NextResponse.json({ error: `tenancy_type must be one of ${TENANCY.join(", ")}.` }, { status: 400 });
  }
  const tenant_credit = text("tenant_credit")?.toLowerCase() ?? null;
  if (tenant_credit && !CREDIT.includes(tenant_credit)) {
    return NextResponse.json({ error: `tenant_credit must be one of ${CREDIT.join(", ")}.` }, { status: 400 });
  }
  const row = {
    property_id,
    listing_type,
    status,
    asking_price,
    asking_rate,
    rate_basis: text("rate_basis"),
    sf,
    cap_rate,
    noi,
    tenancy_type,
    tenant_credit,
    term_remaining_years,
    land_acres,
    listing_broker: text("listing_broker"),
    listing_firm: text("listing_firm"),
    is_cbre: body.is_cbre === true || /cbre/i.test(String(body.listing_firm ?? "")),
    is_dan_listing: body.is_dan_listing === true,
    observed_on,
    source: text("source"),
    source_ref: text("source_ref"),
    notes: text("notes"),
    source_system: text("source_system") ?? "listing_intake",
    source_batch_id: text("source_batch_id"),
  };

  const { data: inserted, error } = await supabase.from("listing_price_history").insert(row).select().single();
  if (error) {
    const code = /foreign key/i.test(error.message) ? 404 : 500;
    return NextResponse.json({ error: code === 404 ? "Property not found." : error.message }, { status: code });
  }

  let market_status: string | null = null;
  if (body.update_market_status !== false) {
    market_status = marketStatusFor(status);
    const { error: upErr } = await supabase.from("properties").update({ market_status }).eq("id", property_id);
    if (upErr) market_status = `not updated: ${upErr.message}`;
  }

  const [{ data: summary }, { data: owners }] = await Promise.all([
    supabase.from("listing_price_summary").select("*").eq("property_id", property_id).eq("listing_type", listing_type).maybeSingle(),
    supabase
      .from("property_owner")
      .select("is_current, entity:entities!entity_id(id, display_code, name, do_not_solicit, represented_by)")
      .eq("property_id", property_id)
      .eq("is_current", true),
  ]);

  return NextResponse.json(
    { observation: inserted, summary, market_status, current_owners: owners ?? [] },
    { status: 201 }
  );
}
