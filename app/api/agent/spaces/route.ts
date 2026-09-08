import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// Agent API for the Space/Lease data model (migration 011, Phase 1 — see
// CRM_Requirements_and_Decisions_Log.md, "9/8/2026 — Space/Lease data model
// designed and built"). Space is a leasable unit within a property (or the
// whole property, for a single-tenant building) — a new, dedicated table,
// NOT another parent_property_id child-property row (the legacy pattern
// used by PROP-0002/0003 and PROP-0006/0007, left untouched).
//
// Built 9/8/2026 to close the gap flagged the same day this table was
// created: schema-only Phase 1 had the Lexington rent-roll data loaded
// directly via the Supabase REST API, with no Agent API route or MCP tool
// to do it through going forward. This route follows the same
// GET/POST/PATCH conventions as every other core table (properties,
// contacts, entities, projects).

// Valid space_status values (enforced by the DB check constraint in
// db/011_spaces_leases.sql, not re-validated here): occupied, vacant,
// owner_occupied.

// GET /api/agent/spaces?limit=50&property_id=...&space_status=vacant
// List spaces, most recently created first. Optional filters: property_id,
// space_status.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limitParam = params.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  let query = supabase
    .from("spaces")
    .select("*, property:properties(display_code, address, suite_number)")
    .order("created_at", { ascending: false })
    .limit(limit);

  for (const field of ["property_id", "space_status"]) {
    const value = params.get(field);
    if (value) query = query.eq(field, value);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ spaces: data });
}

// POST /api/agent/spaces — create a space (a suite/unit within a property).
// Body: { property_id, suite_number?, building_sf?, space_status?, notes? }
// space_status: occupied | vacant | owner_occupied — omit to use the DB
// default (vacant). An invalid value is rejected by the DB's own check
// constraint rather than validated here, same convention as
// properties.market_status/research_status.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const property_id = String(body.property_id || "").trim();
  if (!property_id) {
    return NextResponse.json({ error: "property_id is required." }, { status: 400 });
  }

  const suite_number = String(body.suite_number || "").trim() || null;
  const building_sf_raw = String(body.building_sf ?? "").trim();
  const space_status = String(body.space_status || "").trim();
  const notes = String(body.notes || "").trim() || null;

  const display_code = await nextDisplayCode("spaces", "SPACE");

  const insertPayload: Record<string, unknown> = {
    display_code,
    property_id,
    suite_number,
    building_sf: building_sf_raw ? Number(building_sf_raw) : null,
    notes,
  };
  // Only set space_status when the caller actually provided a value, so an
  // omitted field falls through to the column's DB default instead of
  // being explicitly overwritten with NULL.
  if (space_status) insertPayload.space_status = space_status;

  const { data, error } = await supabase
    .from("spaces")
    .insert(insertPayload)
    .select("*, property:properties(display_code, address, suite_number)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ space: data }, { status: 201 });
}

// PATCH /api/agent/spaces — update one or more fields on an existing space
// by id. Body: { id, ...fields }. Only the fields actually present in the
// body are written — an omitted field is left untouched. A string field
// sent as "" clears it to null. Editable: property_id, suite_number,
// building_sf, space_status, notes. display_code is never editable. At
// least one field besides id is required.
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

  const stringFields = ["property_id", "suite_number", "space_status", "notes"] as const;
  const numericFields = ["building_sf"] as const;

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
          return NextResponse.json({ error: `${field} must be a number.` }, { status: 400 });
        }
        updatePayload[field] = num;
      }
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json(
      {
        error:
          "Provide at least one field to update: property_id, suite_number, building_sf, " +
          "space_status, or notes.",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("spaces")
    .update(updatePayload)
    .eq("id", id)
    .select("*, property:properties(display_code, address, suite_number)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ space: data });
}
