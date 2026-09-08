import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// Agent API for the Space/Lease data model (migration 011, Phase 1 — see
// CRM_Requirements_and_Decisions_Log.md, "9/8/2026 — Space/Lease data model
// designed and built"). A lease is the join record carrying the
// tenant/landlord relationship plus every economic term for one lease
// term — a renewal at new terms is a new row (is_current + as_of_date give
// lightweight versioning), never an update-in-place.
//
// Master Landlord / Sub Landlord (Dan's terminology): a lease with
// master_lease_id null IS a Master Lease (landlord_entity_id = Master
// Landlord, normally the property's fee owner). A lease with
// master_lease_id set is a Sublease (landlord_entity_id = Sub Landlord —
// the master tenant, one level down).
//
// Built 9/8/2026 to close the gap flagged the same day this table was
// created: schema-only Phase 1 had the Lexington rent-roll data loaded
// directly via the Supabase REST API, with no Agent API route or MCP tool
// to do it through going forward.

const SELECT_WITH_JOINS =
  "*, " +
  "space:spaces(display_code, suite_number, property_id), " +
  "tenant_entity:entities!tenant_entity_id(id, display_code, name, trade_name), " +
  "tenant_contact:contacts!tenant_contact_id(id, display_code, first_name, last_name), " +
  "landlord_entity:entities!landlord_entity_id(id, display_code, name, trade_name), " +
  "landlord_contact:contacts!landlord_contact_id(id, display_code, first_name, last_name)";

// GET /api/agent/leases?limit=50&space_id=...&is_current=true
// List leases, most recently created first. Optional filters: space_id,
// tenant_entity_id, landlord_entity_id, master_lease_id, is_current.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limitParam = params.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  let query = supabase
    .from("leases")
    .select(SELECT_WITH_JOINS)
    .order("created_at", { ascending: false })
    .limit(limit);

  for (const field of ["space_id", "tenant_entity_id", "landlord_entity_id", "master_lease_id"]) {
    const value = params.get(field);
    if (value) query = query.eq(field, value);
  }

  const isCurrentParam = params.get("is_current");
  if (isCurrentParam !== null) {
    query = query.eq("is_current", isCurrentParam === "true");
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ leases: data });
}

// POST /api/agent/leases — create a lease.
// Body: { space_id, tenant_entity_id?, tenant_contact_id?,
//         landlord_entity_id?, landlord_contact_id?, master_lease_id?,
//         lease_start_date?, lease_end_date?, base_rent_annual?,
//         base_rent_monthly?, rent_psf?, cam_payment_annual?, cam_psf?,
//         ti_allowance?, is_current?, as_of_date?, comp_eligible?, notes? }
// space_id is required. At least one of tenant_entity_id/tenant_contact_id
// is required (mirrors the DB check constraint — validated here too for a
// clean 400 instead of a raw DB error). is_current/comp_eligible default to
// true (matching the DB column defaults) unless explicitly set false.
// master_lease_id: set it to make this row a Sublease (see file header) —
// omit/null for a Master Lease.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const space_id = String(body.space_id || "").trim();
  if (!space_id) {
    return NextResponse.json({ error: "space_id is required." }, { status: 400 });
  }

  const tenant_entity_id = String(body.tenant_entity_id || "").trim() || null;
  const tenant_contact_id = String(body.tenant_contact_id || "").trim() || null;
  if (!tenant_entity_id && !tenant_contact_id) {
    return NextResponse.json(
      { error: "At least one of tenant_entity_id or tenant_contact_id is required." },
      { status: 400 }
    );
  }

  const landlord_entity_id = String(body.landlord_entity_id || "").trim() || null;
  const landlord_contact_id = String(body.landlord_contact_id || "").trim() || null;
  const master_lease_id = String(body.master_lease_id || "").trim() || null;

  const lease_start_date = body.lease_start_date ? String(body.lease_start_date) : null;
  const lease_end_date = body.lease_end_date ? String(body.lease_end_date) : null;
  const as_of_date = body.as_of_date ? String(body.as_of_date) : null;

  const numericInputs = {
    base_rent_annual: body.base_rent_annual,
    base_rent_monthly: body.base_rent_monthly,
    rent_psf: body.rent_psf,
    cam_payment_annual: body.cam_payment_annual,
    cam_psf: body.cam_psf,
    ti_allowance: body.ti_allowance,
  };
  const numericPayload: Record<string, number | null> = {};
  for (const [field, raw] of Object.entries(numericInputs)) {
    const trimmed = String(raw ?? "").trim();
    numericPayload[field] = trimmed ? Number(trimmed) : null;
  }

  const is_current = body.is_current === undefined ? true : Boolean(body.is_current);
  const comp_eligible = body.comp_eligible === undefined ? true : Boolean(body.comp_eligible);
  const notes = String(body.notes || "").trim() || null;

  const display_code = await nextDisplayCode("leases", "LEASE");

  const { data, error } = await supabase
    .from("leases")
    .insert({
      display_code,
      space_id,
      tenant_entity_id,
      tenant_contact_id,
      landlord_entity_id,
      landlord_contact_id,
      master_lease_id,
      lease_start_date,
      lease_end_date,
      ...numericPayload,
      is_current,
      as_of_date,
      comp_eligible,
      notes,
    })
    .select(SELECT_WITH_JOINS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lease: data }, { status: 201 });
}

// PATCH /api/agent/leases — update one or more fields on an existing lease
// by id. Body: { id, ...fields }. Only the fields actually present in the
// body are written — an omitted field is left untouched. A string/date/FK
// field sent as "" clears it to null. Editable: space_id, tenant_entity_id,
// tenant_contact_id, landlord_entity_id, landlord_contact_id,
// master_lease_id, lease_start_date, lease_end_date, as_of_date,
// base_rent_annual, base_rent_monthly, rent_psf, cam_payment_annual,
// cam_psf, ti_allowance, is_current, comp_eligible, notes. display_code is
// never editable. At least one field besides id is required.
//
// Typical uses: correcting a term after re-confirming with the owner (e.g.
// the Lake and Home Real Estate renewal-date discrepancy flagged in notes
// at load time), or setting is_current: false on a superseded row once its
// renewal is entered as a new lease.
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

  const stringFields = [
    "space_id",
    "tenant_entity_id",
    "tenant_contact_id",
    "landlord_entity_id",
    "landlord_contact_id",
    "master_lease_id",
    "lease_start_date",
    "lease_end_date",
    "as_of_date",
    "notes",
  ] as const;
  const numericFields = [
    "base_rent_annual",
    "base_rent_monthly",
    "rent_psf",
    "cam_payment_annual",
    "cam_psf",
    "ti_allowance",
  ] as const;
  const booleanFields = ["is_current", "comp_eligible"] as const;

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
  for (const field of booleanFields) {
    if (field in body) {
      updatePayload[field] = Boolean(body[field]);
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json(
      {
        error:
          "Provide at least one field to update: " +
          [...stringFields, ...numericFields, ...booleanFields].join(", ") + ".",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("leases")
    .update(updatePayload)
    .eq("id", id)
    .select(SELECT_WITH_JOINS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lease: data });
}
