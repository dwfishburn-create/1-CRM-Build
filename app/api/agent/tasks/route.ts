import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";
import { completeTask, cancelTask, type RecurrenceUnit } from "@/lib/tasks";

const RECURRENCE_UNITS: RecurrenceUnit[] = ["none", "day", "week", "month", "year"];

// GET /api/agent/tasks?limit=50&status=open&waiting_on_contact_id=...
// List tasks, most recent first. Optional filters: status, project_id,
// property_id, contact_id, entity_id, requirement_id, waiting_on_contact_id.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limitParam = params.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

  let query = supabase
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  for (const field of [
    "status",
    "project_id",
    "property_id",
    "contact_id",
    "entity_id",
    "requirement_id",
    "waiting_on_contact_id",
  ]) {
    const value = params.get(field);
    if (value) query = query.eq(field, value);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tasks: data });
}

// POST /api/agent/tasks — create a task. A task can stand entirely alone
// (no CRM entity attached) — every link field is optional.
// Body: { description, due_date?, category?, property_id?, project_id?,
//         contact_id?, entity_id?, requirement_id?, waiting_on_contact_id?,
//         recurrence_unit?, recurrence_interval? }
// Mirrors app/tasks/actions.ts:createTask field-for-field.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const description = String(body.description || "").trim();
  if (!description) {
    return NextResponse.json({ error: "description is required." }, { status: 400 });
  }

  const due_date = body.due_date ? String(body.due_date).trim() : null;
  const category = body.category ? String(body.category).trim() : null;
  const property_id = body.property_id ? String(body.property_id).trim() : null;
  const project_id = body.project_id ? String(body.project_id).trim() : null;
  const contact_id = body.contact_id ? String(body.contact_id).trim() : null;
  const entity_id = body.entity_id ? String(body.entity_id).trim() : null;
  const requirement_id = body.requirement_id ? String(body.requirement_id).trim() : null;
  const waiting_on_contact_id = body.waiting_on_contact_id
    ? String(body.waiting_on_contact_id).trim()
    : null;

  const recurrenceRaw = String(body.recurrence_unit || "none").trim();
  const recurrence_unit: RecurrenceUnit = RECURRENCE_UNITS.includes(
    recurrenceRaw as RecurrenceUnit
  )
    ? (recurrenceRaw as RecurrenceUnit)
    : "none";
  const recurrence_interval =
    body.recurrence_interval !== undefined && body.recurrence_interval !== null
      ? Math.max(1, Number(body.recurrence_interval) || 1)
      : 1;

  const display_code = await nextDisplayCode("tasks", "TASK");

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      display_code,
      description,
      due_date,
      status: "open",
      category,
      property_id,
      project_id,
      contact_id,
      entity_id,
      requirement_id,
      waiting_on_contact_id,
      recurrence_unit,
      recurrence_interval,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ task: data }, { status: 201 });
}

// PATCH /api/agent/tasks — update a task. Body: { id, action } where action
// is "complete" (marks done and, if recurring, creates the next occurrence
// via lib/tasks.ts) or "cancel". For any other field change, use the
// Supabase SQL editor or the web UI — this endpoint is intentionally narrow.
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = String(body.id || "").trim();
  const action = String(body.action || "").trim();

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  if (action !== "complete" && action !== "cancel") {
    return NextResponse.json(
      { error: 'action must be "complete" or "cancel".' },
      { status: 400 }
    );
  }

  try {
    if (action === "complete") {
      await completeTask(id);
    } else {
      await cancelTask(id);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
