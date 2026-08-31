import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/agent/territories?limit=50 — list saved polygons ("research
// zones" / "campaign territories" — see the 8/20/2026 Polygon property
// search decision), most recently created first. Optional ?project_id=
// filter to one project.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;
  const projectId = request.nextUrl.searchParams.get("project_id");

  let query = supabase
    .from("saved_polygons")
    .select("*, project:projects(project_code, client_name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (projectId) query = query.eq("project_id", projectId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ territories: data });
}

// POST /api/agent/territories — save a drawn polygon as a reusable
// research zone / campaign territory. Only the shape + name/notes/project
// tie are stored — which properties fall inside it is always recomputed
// live, never snapshotted (see the 8/26/2026 refinement).
// Body: { name, geojson: {type:"Polygon", coordinates:[[[lng,lat],...]]},
//         project_id?, notes? }
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }

  const geojson = body.geojson as
    | { type?: string; coordinates?: unknown[] }
    | undefined;
  if (
    !geojson ||
    geojson.type !== "Polygon" ||
    !Array.isArray(geojson.coordinates) ||
    !Array.isArray(geojson.coordinates[0]) ||
    (geojson.coordinates[0] as unknown[]).length < 3
  ) {
    return NextResponse.json(
      {
        error:
          'geojson must be a Polygon geometry, e.g. {"type":"Polygon","coordinates":[[[lng,lat],...]]}, with at least 3 points in the first ring.',
      },
      { status: 400 }
    );
  }

  const project_id = String(body.project_id || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;

  const { data, error } = await supabase
    .from("saved_polygons")
    .insert({ name, geojson, project_id, notes })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ territory: data }, { status: 201 });
}
