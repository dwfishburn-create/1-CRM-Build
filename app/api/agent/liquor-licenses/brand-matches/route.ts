import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { brandSuggestions, decideBrand, LiquorError } from "@/lib/liquorLicenses";

// Brand near matches for Dan's review (10/26/2026: exact matches link
// automatically, near matches go to Dan as an Excel sheet).
//
// GET  /api/agent/liquor-licenses/brand-matches?min_score=0.55&limit=1000
//      One row per (brand key, candidate brand), up to 3 candidates per key,
//      keys with the most licenses first.
// POST /api/agent/liquor-licenses/brand-matches
//      { brand_key, decision: "link" | "not_a_match" | "clear", entity_id?, note? }
//      A decision covers every license with that brand key, now and in every
//      later roster pull.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  try {
    const matches = await brandSuggestions(p.get("min_score"), p.get("limit"));
    return NextResponse.json({ matches, count: matches.length });
  } catch (e) {
    const status = e instanceof LiquorError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  try {
    return NextResponse.json({ decision: await decideBrand(body) });
  } catch (e) {
    const status = e instanceof LiquorError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
