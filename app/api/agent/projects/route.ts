import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

// Pipeline fields (migration 025, 10/10/2026). Checked here so a bad value
// comes back as a readable 400 instead of a Postgres constraint error.
const RESULTS = ["active", "inactive", "won", "lost", "dropped"];
const FEE_BASES = ["sale_price", "base_rent_term", "sublease_consideration", "savings_buyout", "flat_fee", "other"];

function pipelineFields(body: Record<string, unknown>, out: Record<string, unknown>): string | null {
  if ("result" in body) {
    const v = String(body.result ?? "").trim() || "active";
    if (!RESULTS.includes(v)) return `result must be one of: ${RESULTS.join(", ")}.`;
    out.result = v;
  }
  for (const f of ["result_date", "result_note"] as const) {
    if (f in body) out[f] = String(body[f] ?? "").trim() || null;
  }
  if ("fee_basis" in body) {
    const v = String(body.fee_basis ?? "").trim();
    if (v && !FEE_BASES.includes(v)) return `fee_basis must be one of: ${FEE_BASES.join(", ")} (or empty to clear).`;
    out.fee_basis = v || null;
  }
  if ("dan_share_pct" in body) {
    const raw = body.dan_share_pct;
    if (raw === null || raw === "") out.dan_share_pct = null;
    else {
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0 || n > 100) return "dan_share_pct must be a percent between 0 and 100.";
      out.dan_share_pct = n;
    }
  }
  if (body.mark_setup_done === true) out.pipeline_setup_at = new Date().toISOString();
  if (body.mark_setup_done === false) out.pipeline_setup_at = null;
  return null;
}

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
//         target_close_date?, notes?, deal_price?, commission_rate?,
//         probability_pct?, strategic_weight_note? }
// project_type is Dan's existing engagement taxonomy: TR/BR/CL/CS/L/LRT/LRLL.
// Mirrors app/projects/actions.ts:createProject field-for-field.
//
// deal_price/commission_rate/probability_pct/strategic_weight_note are the
// 9/2/2026 Value/Probability/Expected-Value scoring fields (see
// CRM_Requirements_and_Decisions_Log.md, 8/23/2026 design). All four are
// optional at creation — per that design, deal value is filled in as Dan
// pulls deal documents/property info into the project, not necessarily at
// project setup. deal_value and expected_value are DB-generated columns
// (deal_price * commission_rate / 100, and that times probability_pct/100)
// — never accepted on the request body, computed automatically.
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
  const strategic_weight_note =
    String(body.strategic_weight_note || "").trim() || null;

  const insertPayload: Record<string, unknown> = {
    project_code,
    project_type,
    client_name,
    status,
    start_date,
    target_close_date,
    notes,
    strategic_weight_note,
  };
  // client_entity_id (migration 022): the client's entity record. Drives the
  // client-lease derivation, so set it whenever the client is on file.
  const client_entity_id = String(body.client_entity_id || "").trim();
  if (client_entity_id) insertPayload.client_entity_id = client_entity_id;

  const pipelineError = pipelineFields(body, insertPayload);
  if (pipelineError) {
    return NextResponse.json({ error: pipelineError }, { status: 400 });
  }

  for (const field of ["deal_price", "commission_rate", "probability_pct"] as const) {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === "") continue;
    const num = Number(raw);
    if (Number.isNaN(num)) {
      return NextResponse.json(
        { error: `${field} must be a number.` },
        { status: 400 }
      );
    }
    if (field === "probability_pct" && (num < 0 || num > 100)) {
      return NextResponse.json(
        { error: "probability_pct must be between 0 and 100." },
        { status: 400 }
      );
    }
    insertPayload[field] = num;
  }

  const { data, error } = await supabase
    .from("projects")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ project: data }, { status: 201 });
}

// PATCH /api/agent/projects — update one or more fields on an existing
// project. Body: { id, ...fields }. Only the fields actually present in
// the body are written — an omitted field is left untouched; a string
// field sent as an empty string clears it to null; a numeric field sent
// as an empty value clears it to null. Editable string fields:
// project_code, project_type, client_name, status, start_date,
// target_close_date, notes, strategic_weight_note. Editable numeric
// fields: deal_price, commission_rate, probability_pct (0-100). At least
// one field besides id is required. deal_value/expected_value are
// DB-generated (never accepted here — see the POST handler above).
//
// Added 9/2/2026, same pattern/motivation as update_contact (9/1/2026) and
// update_entity/the update_property extension (9/2/2026) — a spelling
// correction like the 8/31/2026 Astlali Concina->Cocina fix needed raw SQL
// because no update path existed for projects. Extended the same day to
// cover the Value/Probability/Expected-Value scoring fields (migration
// 010) — the same "no supported fix path" gap that motivated the PATCH
// route itself now applies to deal_price/commission_rate/probability_pct
// as deal terms get confirmed or corrected after project setup. See
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

  const stringFields = [
    "project_code",
    "project_type",
    "client_name",
    "status",
    "start_date",
    "target_close_date",
    "notes",
    "strategic_weight_note",
    "client_entity_id",
  ] as const;
  const numericFields = [
    "deal_price",
    "commission_rate",
    "probability_pct",
  ] as const;

  const updatePayload: Record<string, unknown> = {};
  for (const field of stringFields) {
    if (field in body) {
      const value = String(body[field] ?? "").trim();
      updatePayload[field] = value || null;
    }
  }
  for (const field of numericFields) {
    if (field in body) {
      const raw = body[field];
      if (raw === null || raw === "") {
        updatePayload[field] = null;
      } else {
        const num = Number(raw);
        if (Number.isNaN(num)) {
          return NextResponse.json(
            { error: `${field} must be a number.` },
            { status: 400 }
          );
        }
        if (field === "probability_pct" && (num < 0 || num > 100)) {
          return NextResponse.json(
            { error: "probability_pct must be between 0 and 100." },
            { status: 400 }
          );
        }
        updatePayload[field] = num;
      }
    }
  }

  const pipelineError = pipelineFields(body, updatePayload);
  if (pipelineError) {
    return NextResponse.json({ error: pipelineError }, { status: 400 });
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json(
      {
        error:
          "Provide at least one field to update: " +
          [...stringFields, ...numericFields].join(", ") +
          ", result, result_date, result_note, fee_basis, dan_share_pct, mark_setup_done.",
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
