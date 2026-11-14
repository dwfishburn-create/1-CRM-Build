import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createMatchTasks, matchesForProperty, matchesForRequirement } from "@/lib/requirementMatch";
import { resolveRecordId } from "@/lib/resolveRecordId";

// Requirement matching (11/14/2026, migration 037 — Phase 4 of Retail Listing
// Intake & Matching). Scoring rule: lib/requirementMatchCore.ts.
//
// GET  /api/agent/requirement-matches?property_id=<uuid>
//        → "Who wants this?": every active / on-hold requirement scored
//          against the property and its latest listing(s), strong first.
// GET  /api/agent/requirement-matches?requirement_id=<uuid>[&include_off_market=true]
//        → listed properties scored against the requirement; with
//          include_off_market, also the strong off-market fits (top 25).
// POST /api/agent/requirement-matches  { property_id, dry_run? }
//        → creates one Your Move task (category listing_match) per strong
//          match on a live listing, de-duplicated; returns created/skipped.
// property_id / requirement_id accept the uuid or the display code (PROP-3515, REQ-0013).

function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : 500 });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const propertyId = sp.get("property_id");
  const requirementId = sp.get("requirement_id");
  try {
    if (propertyId) {
      const r = await matchesForProperty(await resolveRecordId("properties", propertyId));
      return NextResponse.json({
        property: r.property,
        listings: r.listings,
        owners: r.owners,
        strong: r.matches.filter((m) => m.strong).length,
        matches: r.matches,
      });
    }
    if (requirementId) {
      const r = await matchesForRequirement(await resolveRecordId("requirements", requirementId), {
        includeOffMarket: sp.get("include_off_market") === "true",
      });
      return NextResponse.json(r);
    }
  } catch (e) {
    return fail(e);
  }
  return NextResponse.json({ error: "property_id or requirement_id is required." }, { status: 400 });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const propertyId = String(body.property_id || "").trim();
  if (!propertyId) return NextResponse.json({ error: "property_id is required." }, { status: 400 });
  try {
    const r = await createMatchTasks(await resolveRecordId("properties", propertyId), {
      dryRun: body.dry_run === true,
    });
    return NextResponse.json({
      property: { id: r.property.id, display_code: r.property.display_code, address: r.property.address },
      created: r.results.filter((x) => x.action === "created").length,
      results: r.results,
      matches: r.matches,
    });
  } catch (e) {
    return fail(e);
  }
}
