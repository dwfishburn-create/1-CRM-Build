import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  DEADLINE_SELECT,
  createDeadline,
  listDeadlineTypes,
  updateDeadline,
} from "@/lib/deadlines";

// Agent API for project deadlines (migration 022, 9/29/2026) — contract dates
// on a project: listing expiration, tail, prospect list, PA effective and
// deposit, DD, objections, closing, LOI, deposits, delivery, option notice.
// deadline_type is a closed list (deadline_types); derived dates are created
// by the database. Warnings become Dashboard tasks via the daily cron.

async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// GET /api/agent/deadlines?project_id=&open=true&from=&to=&include_types=true
// Sorted by date, undated last.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = Math.min(Number(params.get("limit")) || 100, 200);

  let query = supabase
    .from("project_deadlines")
    .select(DEADLINE_SELECT)
    .order("deadline_date", { ascending: true, nullsFirst: false })
    .limit(limit);

  const projectId = params.get("project_id");
  if (projectId) query = query.eq("project_id", projectId);
  const type = params.get("deadline_type");
  if (type) query = query.eq("deadline_type", type);
  if (params.get("open") === "true") query = query.eq("is_completed", false);
  const from = params.get("from");
  if (from) query = query.gte("deadline_date", from);
  const to = params.get("to");
  if (to) query = query.lte("deadline_date", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const body: Record<string, unknown> = { deadlines: data, count: data?.length ?? 0 };
  if (params.get("include_types") === "true") {
    try {
      body.deadline_types = await listDeadlineTypes();
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }
  return NextResponse.json(body);
}

// POST /api/agent/deadlines
// Body: { project_id, deadline_type, deadline_date?, amount?, notes?,
//         source_document?, is_completed?, deposit_offset_days?, source_* }
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  try {
    const result = await createDeadline(body as never);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// PATCH /api/agent/deadlines — { id, ...fields }. Only fields present change.
export async function PATCH(request: NextRequest) {
  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const patch = { ...body };
  delete patch.id;
  try {
    return NextResponse.json(await updateDeadline(id, patch));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
