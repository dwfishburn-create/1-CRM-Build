import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getLicense, linkLicense, LiquorError, searchLicenses } from "@/lib/liquorLicenses";

// Nebraska liquor licenses (10/26/2026, migration 032) — a reference dataset
// refreshed from NLCC roster pulls, not CRM records. Thin wrapper over
// lib/liquorLicenses.ts, which the web screens use too.

function fail(e: unknown) {
  if (e instanceof LiquorError) return NextResponse.json({ error: e.message }, { status: e.status });
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
}

// GET /api/agent/liquor-licenses — search. Query params, all optional, ANDed:
//   q             trade name / licensee / manager / email / license number / street / city
//   city, county  exact (case-insensitive)
//   sale_types    comma list: on_premise, both, off_premise, maker, wholesale, other
//   status        active (default) | dropped | all
//   min_operator  operator holds at least N active licenses statewide
//   new_since, dropped_since   YYYY-MM-DD
//   entity_id     licenses whose brand OR licensee company is this entity
//   property_id   licenses at this CRM property
//   brand         any | linked | unlinked
//   sort          name (default) | operator | newest | city
//   limit (default 50, max 1000), offset
// GET ?license_number=123456 returns that one license with its change history.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  try {
    const num = p.get("license_number");
    if (num) return NextResponse.json(await getLicense(num));
    return NextResponse.json(
      await searchLicenses({
        q: p.get("q"), city: p.get("city"), county: p.get("county"), sale_types: p.get("sale_types"),
        status: p.get("status"), min_operator: p.get("min_operator"), new_since: p.get("new_since"),
        dropped_since: p.get("dropped_since"), entity_id: p.get("entity_id"), property_id: p.get("property_id"),
        brand: p.get("brand"), sort: p.get("sort"), limit: p.get("limit"), offset: p.get("offset"),
      })
    );
  } catch (e) {
    return fail(e);
  }
}

// PATCH /api/agent/liquor-licenses — set or clear one license's links.
// Body: { license_number, brand_entity_id?, licensee_entity_id?, property_id?,
//         contact_id?, notes?, clear?: ["brand"|"licensee"|"property"|"contact"] }
// A link set here is Dan's ('dan') and survives every later roster import.
// brand_entity_id must be a Tenant Directory brand (409 otherwise).
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  try {
    return NextResponse.json({ liquor_license: await linkLicense(body) });
  } catch (e) {
    return fail(e);
  }
}
