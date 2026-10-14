import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { markVerified, RetailBrandError } from "@/lib/retailBrands";

// POST /api/agent/retail-brands/verify — Dan has confirmed a brand profile
// (10/13/2026, migration 026). Body: { id? , entity_id?, note? }.
//
// Every seeded profile starts needs_verification = true (the RealNex retail
// groups are a starting point, not the truth). This clears the flag and
// stamps last_verified_on with today's Central date; a note, if given,
// replaces verification_note. Its own route rather than a PATCH field so the
// date is always the server's today, never one a caller typed.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const brand = await markVerified(
      { id: body.id ? String(body.id) : null, entity_id: body.entity_id ? String(body.entity_id) : null },
      body.note ? String(body.note) : null
    );
    return NextResponse.json({ retail_brand: brand });
  } catch (e) {
    if (e instanceof RetailBrandError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
