import { provenance } from "@/lib/provenance";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createBrand,
  listBrands,
  RetailBrandError,
  updateBrand,
} from "@/lib/retailBrands";

// Retail Tenant Directory — brand profiles (10/13/2026, migration 026).
//
// A brand is an ordinary entity plus ONE retail_brands row. Everything here is
// a thin wrapper over lib/retailBrands.ts, which the web screens call too, so
// the closed-list validation exists once.

function fail(e: unknown) {
  if (e instanceof RetailBrandError) {
    return NextResponse.json({ error: e.message, ...(e.body ?? {}) }, { status: e.status });
  }
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
}

// GET /api/agent/retail-brands — the directory (view retail_brand_directory),
// sorted by name. Query params, all optional and ANDed:
//   q (or search)       name / trade name contains
//   category            retail_categories.code
//   market              one of omaha_metro, lincoln, greater_nebraska, cb_western_iowa
//   expansion_status    expanding, selective, not_expanding, contracting, unknown
//   fits_sf             size_min_sf <= X <= size_max_sf; a missing bound is open
//   needs_verification  true / false
//   limit (default 25, max 100), offset
// Returns { brands, count, limit, offset, has_more }.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  try {
    const result = await listBrands({
      q: p.get("q") ?? p.get("search"),
      category: p.get("category"),
      market: p.get("market"),
      expansion_status: p.get("expansion_status"),
      fits_sf: p.get("fits_sf"),
      needs_verification: p.get("needs_verification"),
      limit: p.get("limit"),
      offset: p.get("offset"),
    });
    return NextResponse.json(result);
  } catch (e) {
    return fail(e);
  }
}

// POST /api/agent/retail-brands — add an existing entity to the directory.
// Body: { entity_id, category?, category_detail?, size_min_sf?, size_max_sf?,
//         frontage_min_ft?, drive_thru?, facility_types?, site_criteria?,
//         operating_model?, expansion_status?, target_markets?,
//         needs_verification?, last_verified_on?, verification_note?, notes?,
//         source_system?, source_record_id?, source_batch_id? }
// 409 if the entity already has a profile (existing_brand_id is returned).
// needs_verification defaults to true in the table: a profile is unverified
// until Dan says otherwise.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fields = { ...body };
  delete fields.entity_id;
  delete fields.source_system;
  delete fields.source_record_id;
  delete fields.source_batch_id;

  try {
    const brand = await createBrand(String(body.entity_id ?? ""), fields, provenance(body));
    return NextResponse.json({ retail_brand: brand }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

// PATCH /api/agent/retail-brands — update a profile, found by id (the
// retail_brands id) or entity_id. Only fields present in the body are
// written; "" or null clears a field (an array field to empty,
// expansion_status to 'unknown'). Arrays accept a JSON array or a
// comma-separated string. At least one field besides id/entity_id is required.
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fields = { ...body };
  delete fields.id;
  delete fields.entity_id;

  try {
    const brand = await updateBrand(
      { id: body.id ? String(body.id) : null, entity_id: body.entity_id ? String(body.entity_id) : null },
      fields
    );
    return NextResponse.json({ retail_brand: brand });
  } catch (e) {
    return fail(e);
  }
}
