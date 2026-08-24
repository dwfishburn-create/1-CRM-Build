import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// GET /api/agent/companies?limit=50 — list companies, most recent first.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ companies: data });
}

// POST /api/agent/companies — create a company.
// Body: { name, industry?, website?, notes? }
// Mirrors app/companies/actions.ts:createCompany field-for-field.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  }

  const industry = String(body.industry || "").trim() || null;
  const website = String(body.website || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;

  const display_code = await nextDisplayCode("companies", "CO");

  const { data, error } = await supabase
    .from("companies")
    .insert({
      display_code,
      name,
      industry,
      website,
      notes,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ company: data }, { status: 201 });
}
