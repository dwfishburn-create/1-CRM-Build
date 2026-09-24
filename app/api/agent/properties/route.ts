import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";
import { geocodeAddress } from "@/lib/geocode";
import { parseListParams, resolveSelect, runSearch } from "@/lib/listQuery";
import {
  findNearMatches,
  blockingMatches,
  duplicateBlockResponse,
} from "@/lib/nearMatch";

const PROPERTY_COLUMNS = [
  "id",
  "display_code",
  "address",
  "suite_number",
  "city",
  "state",
  "zip",
  "county",
  "parcel_number",
  "property_type",
  "submarket",
  "building_sf",
  "land_acres",
  "year_built",
  "parent_property_id",
  "market_status",
  "research_status",
  "priority",
  "latitude",
  "longitude",
  "notes",
  "created_at",
  "updated_at",
] as const;

const PROPERTY_SELECTS = {
  summary:
    "id, display_code, address, suite_number, city, state, zip, parcel_number, " +
    "property_type, building_sf, market_status, research_status, parent_property_id",
  full: "*",
};

function coerceBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

// GET /api/agent/properties — list or search properties, most recent first.
//
// Query params: search, fields ("summary" | "full" | column list), limit
// (default 25, max 100), offset. Returns
// { properties, count, limit, offset, has_more }.
//
// Rewritten 9/24/2026. Properties were the last core table with no lookup —
// this endpoint took a limit and nothing else, so the only way to check
// whether an address was already on file was to pull rows and read them, the
// same dead end contacts and entities were in before migration 014. Search
// runs against the search_text generated column from migration 016 (address,
// suite, city, state, zip, parcel number, submarket), one chained ilike per
// whitespace-separated token, so tokens are ANDed.
//
// Parcel number is in there deliberately (Dan's call, 9/22/2026): 1,549 of the
// 3,834 RealNex properties carry one, and it catches the duplicates address
// matching misses.
export async function GET(request: NextRequest) {
  const params = parseListParams(request.nextUrl.searchParams);

  const resolved = resolveSelect(params.fields, PROPERTY_SELECTS, PROPERTY_COLUMNS);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  // Searching goes through search_property_ids (migration 017), so a query
  // matches in both directions: "South 61st Avenue" finds a row stored as
  // "3606 S 61st Ave Cir", and vice versa.
  if (params.terms.length > 0) {
    const hits = await runSearch(
      (fn, args) => supabase.rpc(fn, args),
      "search_property_ids",
      {
        p_q: request.nextUrl.searchParams.get("search") ?? "",
        p_limit: params.limit,
        p_offset: params.offset,
      }
    );

    if ("error" in hits) {
      return NextResponse.json({ error: hits.error }, { status: 500 });
    }

    if (hits.ids.length === 0) {
      return NextResponse.json({
        properties: [],
        count: hits.count,
        limit: params.limit,
        offset: params.offset,
        has_more: false,
      });
    }

    const { data: rows, error: rowError } = await supabase
      .from("properties")
      .select(resolved.select)
      .in("id", hits.ids)
      .order("created_at", { ascending: false });

    if (rowError) {
      return NextResponse.json({ error: rowError.message }, { status: 500 });
    }

    return NextResponse.json({
      properties: rows,
      count: hits.count,
      limit: params.limit,
      offset: params.offset,
      has_more: params.offset + (rows?.length ?? 0) < hits.count,
    });
  }

  const query = supabase
    .from("properties")
    .select(resolved.select, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    properties: data,
    count: count ?? null,
    limit: params.limit,
    offset: params.offset,
    has_more: count === null ? false : params.offset + (data?.length ?? 0) < count,
  });
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

  // Duplicate check (added 9/24/2026, migration 016). Runs before geocoding,
  // so a refused create costs no geocoder call. Matching is on the normalized
  // address — directionals and street-suffix words removed — plus the parcel
  // number, so "3606 South 61st Avenue Circle" and "3606 S 61st Ave Cir"
  // collide, as do two rows sharing an APN under different street spellings.
  //
  // A space/suite inside a building is a legitimate second row at the same
  // street address, so when parent_property_id is set the block is skipped and
  // the candidates are reported instead — a suite is supposed to look like its
  // parent.
  const allow_duplicate = coerceBoolean(body.allow_duplicate);
  let possible_duplicates: unknown[] = [];
  let duplicate_check: string | null = null;

  const near = await findNearMatches("find_similar_properties", {
    p_address: address,
    p_city: city,
    p_parcel: parcel_number,
    p_limit: 5,
  });

  if (!near.ok) {
    duplicate_check = `not run: ${near.error}`;
  } else {
    possible_duplicates = near.candidates;
    const blocking = blockingMatches(near.candidates);
    if (blocking.length > 0 && !allow_duplicate && !parent_property_id) {
      return duplicateBlockResponse("property", blocking);
    }
    if (blocking.length > 0) {
      duplicate_check = parent_property_id
        ? "skipped: creating a space/suite inside an existing property"
        : "overridden by allow_duplicate";
    }
  }

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

  return NextResponse.json(
    {
      property: data,
      ...(possible_duplicates.length > 0 ? { possible_duplicates } : {}),
      ...(duplicate_check ? { duplicate_check } : {}),
    },
    { status: 201 }
  );
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

// DELETE /api/agent/properties?id=<uuid>&force=true — remove a property.
//
// Added 9/24/2026. Refuses by default when anything references it, and names
// merge_properties as the right tool for a duplicate.
//
// The force path here is more dangerous than it is for contacts or entities,
// and the response says so in the numbers rather than in an adjective:
// spaces.property_id is NOT NULL ON DELETE CASCADE, leases.space_id is NOT
// NULL ON DELETE CASCADE under that, and lease_events under those. Deleting a
// property with spaces destroys the lease history attached to it — the
// critical dates the whole 13-month reminder design depends on — and Postgres
// will not complain. cascade_destroys, from property_link_counts, counts
// exactly what would go, and a property whose spaces carry leases is refused
// outright: that is never what a delete is for.
export async function DELETE(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json(
      { error: "id is required, as a query parameter: ?id=<uuid>" },
      { status: 400 }
    );
  }

  const force = coerceBoolean(request.nextUrl.searchParams.get("force"));

  const { data: property, error: findError } = await supabase
    .from("properties")
    .select("id, display_code, address, suite_number, city")
    .eq("id", id)
    .maybeSingle();

  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }
  if (!property) {
    return NextResponse.json({ error: `No property with id ${id}.` }, { status: 404 });
  }

  const { data: links, error: linkError } = await supabase.rpc("property_link_counts", {
    p_id: id,
  });

  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  const counts = (links ?? {}) as Record<string, unknown>;
  const cascade = (counts.cascade_destroys ?? {}) as Record<string, number>;

  const linked = Object.entries(counts)
    .filter(([key, value]) => key !== "cascade_destroys" && Number(value) > 0)
    .map(([key, value]) => `${key}: ${value}`);

  const leaseCount = Number(cascade.leases_under_those_spaces ?? 0);
  if (leaseCount > 0) {
    return NextResponse.json(
      {
        error:
          `Refused: ${leaseCount} lease(s) hang off this property's spaces and would ` +
          "be destroyed with it, along with their lease events — the executed-lease " +
          "history and critical dates. force does not override this. If this is a " +
          "duplicate, use merge_properties, which moves the spaces and leases to the " +
          "surviving property. If the leases really are wrong, delete them first.",
        cascade_destroys: cascade,
        links: counts,
        property,
      },
      { status: 409 }
    );
  }

  if (linked.length > 0 && !force) {
    return NextResponse.json(
      {
        error:
          `Refused: ${linked.length} table(s) still reference this property. ` +
          "If this is a duplicate, use merge_properties (POST /api/agent/properties/merge) " +
          "so the links move to the surviving record instead of being destroyed. " +
          "If deletion really is right, repeat with force=true.",
        links: counts,
        cascade_destroys: cascade,
        property,
      },
      { status: 409 }
    );
  }

  const { error: deleteError } = await supabase.from("properties").delete().eq("id", id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    deleted: true,
    property,
    links_destroyed: linked.length > 0 ? counts : null,
  });
}
