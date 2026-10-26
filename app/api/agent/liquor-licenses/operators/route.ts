import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listOperators, LiquorError } from "@/lib/liquorLicenses";

// GET /api/agent/liquor-licenses/operators — multi-unit operators: one row per
// licensee company (or licensee name when not linked) with its active license
// count statewide and in the filtered area. Params: min_licenses (default 2),
// county, city, sale_types (comma list), q, limit (default 100, max 1000), offset.
// Sorted by licenses in the area, then statewide.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  try {
    return NextResponse.json(
      await listOperators({
        min_licenses: p.get("min_licenses"), county: p.get("county"), city: p.get("city"),
        sale_types: p.get("sale_types"), q: p.get("q"), limit: p.get("limit"), offset: p.get("offset"),
      })
    );
  } catch (e) {
    const status = e instanceof LiquorError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
