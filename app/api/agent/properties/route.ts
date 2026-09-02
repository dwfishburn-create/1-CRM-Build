import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";
import { geocodeAddress } from "@/lib/geocode";

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
// Body: { address, city?, state?, zip?, county?, parcel_number?,
//         property_type?, submarket?, building_sf?, land_acres?,
//         year_built?, parent_property_id?, suite_number?, market_status?,
//         research_status?, latitude?, longitude?, notes? }
// parent_property_id: omit/null for a standalone building/parcel; set it to
// the parent property's id to create a leasable space/suite inside it (its
// own address + suite_number, distinct from the parent's own address).
// market_status / research_status: omit to let the DB apply its own column
// default (market_status -> off_market, research_status -> unresearched).
// An invalid value is rejected by the DB's own check constraint rather than
// validated here.
// latitude/longitude: omit to geocode the address automatically (best-effort
// — see lib/geocode.ts; a miss just leaves both null, it never blocks the
// create). Pass explicit values to skip geocoding (e.g. a space/suite that
// should inherit its parent's coordinates, or a hand-corrected pin).
// Mirrors app/properties/actions.ts:createProperty field-for-field, plus
// market_status/research_status/latitude/longitude which that form doesn't
// expose yet.
//
// Bug fixed 8/26/2026: previously this route never read market_status (or
// research_status) from the body at all, so any value a caller sent was
// silently discarded and every row landed on the DB default regardless —
// no error, it just looked like the field had been ignored. See
// CRM_Requirements_and_Decisions_Log.md.
//
// Bug fixed 8/27/2026: same failure shape, different fields — county,
// parcel_number, and year_built are real columns (see 001_init_schema.sql)
// but this route never read any of them from the body at all, so a caller
// sending year_built: 1963 got a 201 back with the value silently dropped
// (year_built: null), discovered while entering CL-4930 L St. See
// CRM_Requirements_and_Decisions_Log.md.
//
// priority added 8/30/2026 alongside the roadmap item 7 (map/polygon
// tool) build — freeform text, no DB enum, same convention as
// project_contacts.role / reference_links.link_type.
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
  const county = String(body.county || "").trim() || null;
  const parcel_number = String(body.parcel_number || "").trim() || null;
  const property_type = String(body.property_type || "").trim() || null;
  const submarket = String(body.submarket || "").trim() || null;
  const building_sf_raw = String(body.building_sf ?? "").trim();
  const land_acres_raw = String(body.land_acres ?? "").trim();
  const year_built_raw = String(body.year_built ?? "").trim();
  const parent_property_id = String(body.parent_property_id || "").trim() || null;
  const suite_number = String(body.suite_number || "").trim() || null;
  const market_status = String(body.market_status || "").trim();
  const research_status = String(body.research_status || "").trim();
  const priority = String(body.priority || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;

  // latitude/longitude: an explicit caller-supplied value always wins over
  // auto-geocoding.
  let latitude: number | null =
    typeof body.latitude === "number" ? body.latitude : null;
  let longitude: number | null =
    typeof body.longitude === "number" ? body.longitude : null;

  if (latitude === null && longitude === null) {
    // Best-effort — a geocoding miss (bad address, API hiccup, timeout)
    // never blocks the property create. It just leaves both columns null,
    // same as every property created before this code existed.
    const geocoded = await geocodeAddress({ address, city, state, zip });
    if (geocoded) {
      latitude = geocoded.latitude;
      longitude = geocoded.longitude;
    }
  }

  const display_code = await nextDisplayCode("properties", "PROP");

  const insertPayload: Record<string, unknown> = {
    display_code,
    address,
    city,
    state,
    zip,
    county,
    parcel_number,
    property_type,
    submarket,
    building_sf: building_sf_raw ? Number(building_sf_raw) : null,
    land_acres: land_acres_raw ? Number(land_acres_raw) : null,
    year_built: year_built_raw ? Number(year_built_raw) : null,
    parent_property_id,
    suite_number,
    latitude,
    longitude,
    priority,
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

// PATCH /api/agent/properties — two modes:
// 1. { id, action: "geocode" } — looks up the property's own address/city/
//    state/zip and (re)geocodes it. This is the backfill path: a session
//    can list_properties, find rows with latitude/longitude null, and
//    PATCH each one by id without needing to already know its address.
// 2. { id, ...fields } — partial update of one or more editable fields:
//    address, city, state, zip, county, parcel_number, property_type,
//    submarket, building_sf, land_acres, year_built, parent_property_id,
//    suite_number, market_status, research_status, priority, notes,
//    latitude, longitude. Only fields present in the body are written —
//    an omitted field is left untouched. A string field sent as "" clears
//    it to null. A numeric field (building_sf, land_acres, year_built,
//    latitude, longitude) accepts a number or numeric string; an empty
//    value clears it to null. display_code is never editable. At least
//    one field besides id (or action) is required.
//
// Extended 9/2/2026 from the original geocode-only PATCH, closing the same
// gap update_contact closed for contacts — PROP-0003's building_sf was
// stuck at a confirmed-wrong 1800 with no supported way to correct it
// (see CRM_Requirements_and_Decisions_Log.md, "PROP-0003 building_sf").
// Backward compatible: an existing caller sending { id, latitude,
// longitude } with no action still works exactly as before, now routed
// through the general-field path (latitude/longitude are just two of the
// numeric editable fields) instead of a hardcoded lat/long-only branch.
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = String(body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const action = String(body.action || "").trim();

  if (action === "geocode") {
    const { data: existing, error: fetchError } = await supabase
      .from("properties")
      .select("address, city, state, zip")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: fetchError?.message || "Property not found." },
        { status: 404 }
      );
    }

    const geocoded = await geocodeAddress(existing);
    if (!geocoded) {
      return NextResponse.json(
        { error: "No geocode match for this property's address.", geocoded: false },
        { status: 200 }
      );
    }

    const { data, error } = await supabase
      .from("properties")
      .update({ latitude: geocoded.latitude, longitude: geocoded.longitude })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ property: data, geocoded: true });
  }

  const stringFields = [
    "address",
    "city",
    "state",
    "zip",
    "county",
    "parcel_number",
    "property_type",
    "submarket",
    "parent_property_id",
    "suite_number",
    "market_status",
    "research_status",
    "priority",
    "notes",
  ] as const;
  const numericFields = [
    "building_sf",
    "land_acres",
    "year_built",
    "latitude",
    "longitude",
  ] as const;

  const updatePayload: Record<string, unknown> = {};
  for (const field of stringFields) {
    if (field in body) {
      const value = String(body[field] ?? "").trim();
      updatePayload[field] = value || null;
    }
  }
  for (const field of numericFields) {
    if (field in body) {
      const raw = body[field];
      if (raw === null || raw === "") {
        updatePayload[field] = null;
      } else {
        const num = Number(raw);
        if (Number.isNaN(num)) {
          return NextResponse.json(
            { error: `${field} must be a number.` },
            { status: 400 }
          );
        }
        updatePayload[field] = num;
      }
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json(
      {
        error:
          'Provide either { action: "geocode" }, or at least one field to update: ' +
          [...stringFields, ...numericFields].join(", ") + ".",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("properties")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ property: data });
}
