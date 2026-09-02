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

// PATCH /api/agent/projects — update one or more fields on an existing
// project. Body: { id, ...fields }. Only the fields actually present in
// the body are written — an omitted field is left untouched; a field sent
// as an empty string clears it to null. Editable fields: project_code,
// project_type, client_name, status, start_date, target_close_date,
// notes. At least one field besides id is required.
//
// Added 9/2/2026, same pattern/motivation as update_contact (9/1/2026) and
// update_entity/the update_property extension (9/2/2026) — a spelling
// correction like the 8/31/2026 Astlali Concina->Cocina fix needed raw SQL
// because no update path existed for projects. See
// CRM_Requirements_and_Decisions_Log.md.
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = String(body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const editableFields = [
    "project_code",
    "project_type",
    "client_name",
    "status",
    "start_date",
    "target_close_date",
    "notes",
  ] as const;

  const updatePayload: Record<string, unknown> = {};
  for (const field of editableFields) {
    if (field in body) {
      const value = String(body[field] ?? "").trim();
      updatePayload[field] = value || null;
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json(
      {
        error:
          "Provide at least one field to update: " + editableFields.join(", ") + ".",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("projects")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ project: data });
}
