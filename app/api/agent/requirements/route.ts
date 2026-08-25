import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// GET /api/agent/requirements?limit=50&status=active — list requirements,
// most recent first. Optional ?status= filter.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;
  const status = request.nextUrl.searchParams.get("status");

  let query = supabase
    .from("requirements")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requirements: data });
}

// POST /api/agent/requirements — create a requirement (a standing, informal
// capture of what someone told Dan they need — not a formal Assignment).
// Body: { deal_type?, property_type?, size_min?, size_max?, budget_min?,
//         budget_max?, target_location?, timeline?, status?, priority?,
//         details?, source? }
// Mirrors app/requirements/actions.ts:createRequirement field-for-field.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const deal_type = body.deal_type ? String(body.deal_type).trim() : null;
  const property_type = body.property_type
    ? String(body.property_type).trim()
    : null;
  const size_min = body.size_min !== undefined && body.size_min !== null ? Number(body.size_min) : null;
  const size_max = body.size_max !== undefined && body.size_max !== null ? Number(body.size_max) : null;
  const budget_min =
    body.budget_min !== undefined && body.budget_min !== null ? Number(body.budget_min) : null;
  const budget_max =
    body.budget_max !== undefined && body.budget_max !== null ? Number(body.budget_max) : null;
  const target_location = body.target_location
    ? String(body.target_location).trim()
    : null;
  const timeline = body.timeline ? String(body.timeline).trim() : null;
  const status = String(body.status || "").trim() || "active";
  const priority = String(body.priority || "").trim() || "medium";
  const details = body.details ? String(body.details).trim() : null;
  const source = body.source ? String(body.source).trim() : null;

  const display_code = await nextDisplayCode("requirements", "REQ");

  const { data, error } = await supabase
    .from("requirements")
    .insert({
      display_code,
      deal_type,
      property_type,
      size_min,
      size_max,
      budget_min,
      budget_max,
      target_location,
      timeline,
      status,
      priority,
      details,
      source,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requirement: data }, { status: 201 });
}
