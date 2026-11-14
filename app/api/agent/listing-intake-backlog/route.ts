import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/agent/listing-intake-backlog?limit=10&needs=owner|price|photo|geocode&dan_only=true
// On-market properties and Dan's active listings still missing price history,
// an owner link, a photo or coordinates (view listing_intake_backlog,
// migration 036). Dan's own listings first, then oldest first — the scheduled
// sweep works through a few per run.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit")) || 10, 100);
  let q = supabase
    .from("listing_intake_backlog")
    .select("*", { count: "exact" })
    .order("is_dan_listing", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);
  const needs = sp.get("needs");
  if (needs) {
    const col = { owner: "needs_owner", price: "needs_price", photo: "needs_photo", geocode: "needs_geocode" }[needs];
    if (!col) return NextResponse.json({ error: "needs must be owner, price, photo or geocode." }, { status: 400 });
    q = q.eq(col, true);
  }
  if (sp.get("dan_only") === "true") q = q.eq("is_dan_listing", true);
  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ backlog: data, total: count, limit });
}
