import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listChanges, LiquorError } from "@/lib/liquorLicenses";

// GET /api/agent/liquor-licenses/changes — what the roster pulls say changed:
// new (openings), dropped (closures / coming vacancies), returned, licensee
// (a sale?), trade_name, manager, class, address. Params: since (YYYY-MM-DD,
// roster date), types (comma list), county, city, sale_types, limit, offset.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  try {
    return NextResponse.json(
      await listChanges({
        since: p.get("since"), types: p.get("types"), county: p.get("county"), city: p.get("city"),
        sale_types: p.get("sale_types"), limit: p.get("limit"), offset: p.get("offset"),
      })
    );
  } catch (e) {
    const status = e instanceof LiquorError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
