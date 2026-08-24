import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/agent/project-properties?limit=50 — list candidate-property
// links, most recent first. Optional ?project_id= filters to one project.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;
  const projectId = request.nextUrl.searchParams.get("project_id");

  let query = supabase
    .from("project_properties")
    .select(
      "*, project:projects(project_code, client_name), property:properties!property_id(display_code, address, suite_number)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ project_properties: data });
}

// POST /api/agent/project-properties — link a property as a candidate on a
// project, or update its status/notes if that project+property pair is
// already linked (upsert on the project_id+property_id unique constraint) —
// e.g. call again with status: "toured" after a showing.
// Body: { project_id, property_id, status?, notes? }
// status: candidate (default) / toured / selected / rejected.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const project_id = String(body.project_id || "").trim();
  const property_id = String(body.property_id || "").trim();

  if (!project_id) {
    return NextResponse.json(
      { error: "project_id is required." },
      { status: 400 }
    );
  }
  if (!property_id) {
    return NextResponse.json(
      { error: "property_id is required." },
      { status: 400 }
    );
  }

  const status = String(body.status || "").trim() || "candidate";
  const notes = String(body.notes || "").trim() || null;

  const { data, error } = await supabase
    .from("project_properties")
    .upsert(
      { project_id, property_id, status, notes },
      { onConflict: "project_id,property_id" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ project_property: data }, { status: 201 });
}
