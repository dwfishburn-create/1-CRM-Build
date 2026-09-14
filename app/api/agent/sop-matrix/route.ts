import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  getSopChecklist,
  getSopMatrix,
  PROJECT_TYPE_CODES,
  SOP_STATUSES,
  type ProjectTypeCode,
  type SopStatus,
} from "@/lib/sopMatrix";

// /api/agent/sop-matrix — read and maintain the companion-SOP routing matrix
// (migration 013), the machine-readable projection of Section 4 of
// New_Project_Setup_and_Categorization_-_SOP.md.
//
// Added 9/14/2026. The point of this route is that re-syncing the matrix after
// an SOP is written or revised is a data edit, not a code change and deploy —
// see CRM_Requirements_and_Decisions_Log.md, 9/14/2026. Gated by proxy.ts like
// every other /api/agent/* route.

const VALID_TYPES = PROJECT_TYPE_CODES as readonly string[];
const VALID_STATUSES = SOP_STATUSES as readonly string[];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/agent/sop-matrix — the whole matrix, plus a staleness verdict.
// GET /api/agent/sop-matrix?project_type=BR — just that type's checklist.
//   project_type accepts a compound value ("TR/BR"), same as the MCP tool.
export async function GET(request: NextRequest) {
  const projectType = request.nextUrl.searchParams.get("project_type");

  try {
    const payload = projectType
      ? await getSopChecklist(projectType)
      : await getSopMatrix();

    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error reading sop_matrix.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/agent/sop-matrix — add a cell.
//
// Use this when a genuinely NEW SOP row is added to Section 4 (one call per
// project_type, or send `all_types: true` with a default status to seed the
// whole row at once). A per-type VARIANT of an existing SOP is not a new row —
// it's a PATCH of that SOP's existing cell. An edit to an existing SOP is
// neither: it belongs in the `note` on the affected cell.
//
// Body: { sop_name, project_type, status, note?, sop_filename?, sort_order? }
//   or: { sop_name, all_types: true, status, note?, sop_filename?, sort_order? }
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sop_name = String(body.sop_name || "").trim();
  if (!sop_name) {
    return NextResponse.json({ error: "sop_name is required." }, { status: 400 });
  }

  const status = String(body.status || "").trim();
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}.` },
      { status: 400 }
    );
  }

  const note = String(body.note || "").trim() || null;
  const sop_filename = String(body.sop_filename || "").trim() || null;
  const sort_order =
    typeof body.sort_order === "number" && Number.isFinite(body.sort_order)
      ? body.sort_order
      : 999;

  const allTypes = body.all_types === true;
  let targets: string[];

  if (allTypes) {
    targets = [...VALID_TYPES];
  } else {
    const project_type = String(body.project_type || "").trim().toUpperCase();
    if (!VALID_TYPES.includes(project_type)) {
      return NextResponse.json(
        {
          error: `project_type must be one of: ${VALID_TYPES.join(", ")} (or send all_types: true).`,
        },
        { status: 400 }
      );
    }
    targets = [project_type];
  }

  const rows = targets.map((project_type) => ({
    sop_name,
    sop_filename,
    project_type: project_type as ProjectTypeCode,
    status: status as SopStatus,
    note,
    sort_order,
  }));

  const { data, error } = await supabase.from("sop_matrix").insert(rows).select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sop_matrix_cells: data }, { status: 201 });
}

// PATCH /api/agent/sop-matrix — two modes, chosen by what's in the body.
//
// 1. Update one cell:
//    { sop_name, project_type, status?, note?, sop_filename?, sort_order?,
//      mark_synced? }
//    Only the fields present are written. Send note: "" to clear a note.
//    mark_synced: true also stamps sop_matrix_meta.source_last_synced with
//    today's date — the normal thing to want after reconciling a change.
//
// 2. Update the metadata row (no sop_name in the body):
//    { source_doc_last_updated?, source_last_synced? }
//    Set source_doc_last_updated whenever the SOP doc's own "Last updated"
//    line moves — that's what makes the staleness verdict meaningful. Set
//    source_last_synced when the rows here have been reconciled against it.
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sop_name = String(body.sop_name || "").trim();

  // --- Mode 2: metadata update ---
  if (!sop_name) {
    const metaUpdate: Record<string, string> = {};

    if (body.source_doc_last_updated !== undefined) {
      metaUpdate.source_doc_last_updated = String(body.source_doc_last_updated).trim();
    }
    if (body.source_last_synced !== undefined) {
      metaUpdate.source_last_synced =
        body.source_last_synced === true
          ? today()
          : String(body.source_last_synced).trim();
    }

    if (!Object.keys(metaUpdate).length) {
      return NextResponse.json(
        {
          error:
            "Nothing to update. Send sop_name + project_type to update a cell, or " +
            "source_doc_last_updated / source_last_synced to update the metadata row.",
        },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("sop_matrix_meta")
      .update(metaUpdate)
      .eq("id", 1)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ sop_matrix_meta: data });
  }

  // --- Mode 1: cell update ---
  const project_type = String(body.project_type || "").trim().toUpperCase();
  if (!VALID_TYPES.includes(project_type)) {
    return NextResponse.json(
      { error: `project_type must be one of: ${VALID_TYPES.join(", ")}.` },
      { status: 400 }
    );
  }

  const update: Record<string, unknown> = {};

  if (body.status !== undefined) {
    const status = String(body.status).trim();
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}.` },
        { status: 400 }
      );
    }
    update.status = status;
  }

  if (body.note !== undefined) {
    update.note = String(body.note).trim() || null;
  }
  if (body.sop_filename !== undefined) {
    update.sop_filename = String(body.sop_filename).trim() || null;
  }
  if (body.sort_order !== undefined && typeof body.sort_order === "number") {
    update.sort_order = body.sort_order;
  }

  if (!Object.keys(update).length) {
    return NextResponse.json(
      { error: "No updatable fields supplied (status, note, sop_filename, sort_order)." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("sop_matrix")
    .update(update)
    .eq("sop_name", sop_name)
    .eq("project_type", project_type)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      {
        error:
          `No sop_matrix cell found for sop_name "${sop_name}" and project_type ` +
          `"${project_type}". Check the exact sop_name (GET this route to list them), or ` +
          `POST to add the cell if this SOP is genuinely new.`,
      },
      { status: 404 }
    );
  }

  let sop_matrix_meta = undefined;

  if (body.mark_synced === true) {
    const { data: metaData, error: metaError } = await supabase
      .from("sop_matrix_meta")
      .update({ source_last_synced: today() })
      .eq("id", 1)
      .select()
      .single();

    if (metaError) {
      return NextResponse.json(
        {
          sop_matrix_cell: data,
          warning: `Cell updated, but source_last_synced was not stamped: ${metaError.message}`,
        },
        { status: 200 }
      );
    }

    sop_matrix_meta = metaData;
  }

  return NextResponse.json({ sop_matrix_cell: data, sop_matrix_meta });
}
