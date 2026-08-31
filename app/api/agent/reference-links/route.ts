import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/agent/reference-links?limit=50 — list reference links (standing
// deal-terms answers, shareable marketing-package/due-diligence links),
// most recent first. Optional ?property_id=/?project_id= filter to one
// property or project.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;
  const propertyId = request.nextUrl.searchParams.get("property_id");
  const projectId = request.nextUrl.searchParams.get("project_id");

  let query = supabase
    .from("reference_links")
    .select(
      "*, property:properties!property_id(display_code, address), project:projects(project_code, client_name), entity:entities!entity_id(display_code, name)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (propertyId) query = query.eq("property_id", propertyId);
  if (projectId) query = query.eq("project_id", projectId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reference_links: data });
}

// POST /api/agent/reference-links — log a structured reference link or
// standing answer, instead of an activity_log note. At least one of
// property_id/project_id is required; entity_id is optional context (e.g.
// "this concerns Hy-Vee specifically"). url is optional — a text-only
// standing answer (e.g. the NNN/CAM/tax figures themselves) can be logged
// via notes alone.
// Body: { label, property_id?, project_id?, entity_id?, url?, link_type?, notes? }
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const label = String(body.label || "").trim();
  if (!label) {
    return NextResponse.json({ error: "label is required." }, { status: 400 });
  }

  const property_id = String(body.property_id || "").trim() || null;
  const project_id = String(body.project_id || "").trim() || null;
  if (!property_id && !project_id) {
    return NextResponse.json(
      { error: "At least one of property_id or project_id is required." },
      { status: 400 }
    );
  }

  const entity_id = String(body.entity_id || "").trim() || null;
  const url = String(body.url || "").trim() || null;
  const link_type = String(body.link_type || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;

  const { data, error } = await supabase
    .from("reference_links")
    .insert({ label, property_id, project_id, entity_id, url, link_type, notes })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reference_link: data }, { status: 201 });
}
