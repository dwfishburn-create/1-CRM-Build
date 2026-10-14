import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listCategories } from "@/lib/retailBrands";

// GET /api/agent/retail-categories — the Retail Tenant Directory's category
// pick list (10/13/2026, migration 026), in display order. Categories are
// data rather than a CHECK constraint so the list can grow without a
// migration; retail_brands.category must be one of these codes.
// ?include_inactive=true also returns retired categories.
export async function GET(request: NextRequest) {
  const includeInactive = request.nextUrl.searchParams.get("include_inactive") === "true";
  try {
    return NextResponse.json({ retail_categories: await listCategories(includeInactive) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
