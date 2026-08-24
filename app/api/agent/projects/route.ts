import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/agent/projects?limit=50 — list projects, most recent first.
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ projects: data });
}

// POST /api/agent/projects — create a project (formal assignment).
// Body: { project_code, project_type, client_name, status?, start_date?,
//         target_close_date?, notes? }
// project_type is Dan's existing engagement taxonomy: TR/BR/CL/CS/L/LRT/LRLL.
// Mirrors app/projects/actions.ts:createProject field-for-field.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const project_code = String(body.project_code || "").trim();
  const project_type = String(body.project_type || "").trim();
  const client_name = String(body.client_name || "").trim();

  if (!project_code) {
    return NextResponse.json(
      { error: "project_code is required." },
      { status: 400 }
    );
  }
  if (!project_type) {
    return NextResponse.json(
      { error: "project_type is required." },
      { status: 400 }
    );
  }
  if (!client_name) {
    return NextResponse.json(
      { error: "client_name is required." },
      { status: 400 }
    );
  }

  const status = String(body.status || "").trim() || "active";
  const start_date = body.start_date ? String(body.start_date) : null;
  const target_close_date = body.target_close_date
    ? String(body.target_close_date)
    : null;
  const notes = String(body.notes || "").trim() || null;

  const { data, error } = await supabase
    .from("projects")
    .insert({
      project_code,
      project_type,
      client_name,
      status,
      start_date,
      target_close_date,
      notes,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ project: data }, { status: 201 });
}
