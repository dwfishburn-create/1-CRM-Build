import { provenance } from "@/lib/provenance";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";
import {
  bumpTask,
  cancelTask,
  completeTask,
  TASK_EDITABLE_FIELDS,
  updateTask,
  type RecurrenceUnit,
  type TaskPatch,
} from "@/lib/tasks";

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
      ...provenance(body),
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

// PATCH /api/agent/tasks — change a task. Body: { id, action, ... }
//   action "complete" — mark done; a recurring task spawns its next occurrence.
//   action "cancel"   — close it without deleting, so the history survives.
//   action "update"   — edit any of description, due_date, category,
//                       waiting_on_contact_id, project_id, property_id,
//                       contact_id, entity_id, requirement_id. Only the fields
//                       present change; "" clears one (waiting_on_contact_id:
//                       "" hands the ball back to Dan). Open tasks only.
//   action "bump"     — push the due date out by `days` (default 7), from the
//                       current due date or from today if it is overdue.
// Added "update"/"bump" 9/24/2026 (fifth pass): before, a slipped follow-up had
// to be cancelled and re-created, losing its link to the source activity.
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
  if (!["complete", "cancel", "update", "bump"].includes(action)) {
    return NextResponse.json(
      { error: 'action must be "complete", "cancel", "update" or "bump".' },
      { status: 400 }
    );
  }

  try {
    if (action === "complete") {
      await completeTask(id);
      return NextResponse.json({ ok: true });
    }
    if (action === "cancel") {
      await cancelTask(id);
      return NextResponse.json({ ok: true });
    }
    if (action === "bump") {
      const days = Number(body.days ?? 7);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return NextResponse.json({ error: "days must be an integer 1–365." }, { status: 400 });
      }
      const task = await bumpTask(id, days);
      return NextResponse.json({ task });
    }
    const patch: TaskPatch = {};
    for (const key of TASK_EDITABLE_FIELDS) {
      if (key in body) patch[key] = body[key] === null ? null : String(body[key]);
    }
    const task = await updateTask(id, patch);
    return NextResponse.json({ task });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed.";
    const status = /not found/i.test(message) ? 404 : /only open|No fields|cannot be empty/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
