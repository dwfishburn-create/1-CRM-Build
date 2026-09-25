import { supabase } from "./supabase";
import { nextDisplayCode } from "./displayCode";

export type RecurrenceUnit = "none" | "day" | "week" | "month" | "year";

type TaskRow = {
  id: string;
  description: string;
  due_date: string | null;
  property_id: string | null;
  project_id: string | null;
  contact_id: string | null;
  entity_id: string | null;
  requirement_id: string | null;
  waiting_on_contact_id: string | null;
  category: string | null;
  recurrence_unit: RecurrenceUnit;
  recurrence_interval: number;
  parent_task_id: string | null;
};

function addInterval(dateStr: string, unit: RecurrenceUnit, interval: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  switch (unit) {
    case "day":
      d.setUTCDate(d.getUTCDate() + interval);
      break;
    case "week":
      d.setUTCDate(d.getUTCDate() + interval * 7);
      break;
    case "month":
      d.setUTCMonth(d.getUTCMonth() + interval);
      break;
    case "year":
      d.setUTCFullYear(d.getUTCFullYear() + interval);
      break;
    case "none":
      break;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Marks a task done and, if it's recurring, spins up the next occurrence.
 * Shared by the web Server Action (app/tasks/actions.ts) and the Agent API
 * (app/api/agent/tasks/route.ts) so the recurrence logic lives in one place.
 */
export async function completeTask(taskId: string): Promise<void> {
  const { data: task, error: fetchError } = await supabase
    .from("tasks")
    .select(
      "id, description, due_date, property_id, project_id, contact_id, entity_id, requirement_id, waiting_on_contact_id, category, recurrence_unit, recurrence_interval, parent_task_id"
    )
    .eq("id", taskId)
    .maybeSingle()
    .returns<TaskRow | null>();

  if (fetchError) throw new Error(fetchError.message);
  if (!task) throw new Error("Task not found.");

  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: now, updated_at: now })
    .eq("id", taskId);

  if (updateError) throw new Error(updateError.message);

  if (task.recurrence_unit !== "none") {
    const basisDate = task.due_date ?? now.slice(0, 10);
    const nextDue = addInterval(basisDate, task.recurrence_unit, task.recurrence_interval);
    const display_code = await nextDisplayCode("tasks", "TASK");

    const { error: insertError } = await supabase.from("tasks").insert({
      display_code,
      description: task.description,
      due_date: nextDue,
      status: "open",
      property_id: task.property_id,
      project_id: task.project_id,
      contact_id: task.contact_id,
      entity_id: task.entity_id,
      requirement_id: task.requirement_id,
      waiting_on_contact_id: task.waiting_on_contact_id,
      category: task.category,
      recurrence_unit: task.recurrence_unit,
      recurrence_interval: task.recurrence_interval,
      parent_task_id: task.parent_task_id ?? task.id,
    });

    if (insertError) throw new Error(insertError.message);
  }
}

export async function cancelTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", taskId);

  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Editing and re-dating (9/24/2026, fifth pass).
//
// Before this a task could only be completed or cancelled — a follow-up that
// slipped a week had to be cancelled and re-created, losing its link to the
// activity it came from (tasks.source_activity_id). Editing keeps the row, its
// display code and that link.
//
// Re-dating a task does NOT rewrite the activity's next_step_due_date: the
// activity records what was agreed on the day; the task is the live queue.
// ---------------------------------------------------------------------------

export const TASK_EDITABLE_FIELDS = [
  "description",
  "due_date",
  "category",
  "waiting_on_contact_id",
  "project_id",
  "property_id",
  "contact_id",
  "entity_id",
  "requirement_id",
] as const;

export type TaskPatch = Partial<Record<(typeof TASK_EDITABLE_FIELDS)[number], string | null>>;

/**
 * Only the fields present in `patch` change. An empty string clears a field
 * (e.g. waiting_on_contact_id: "" hands the ball back to Dan); description
 * cannot be cleared. Refuses to edit a task that is no longer open, so a
 * closed task's record of what was done stays as it was.
 */
export async function updateTask(taskId: string, patch: TaskPatch): Promise<Record<string, unknown>> {
  const update: Record<string, unknown> = {};
  for (const key of TASK_EDITABLE_FIELDS) {
    if (!(key in patch)) continue;
    const raw = patch[key];
    const v = raw === null || raw === undefined ? null : String(raw).trim() || null;
    if (key === "description" && !v) throw new Error("description cannot be empty.");
    update[key] = v;
  }
  if (Object.keys(update).length === 0) throw new Error("No fields to update.");

  const { data: existing, error: fetchError } = await supabase
    .from("tasks")
    .select("id, status")
    .eq("id", taskId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!existing) throw new Error("Task not found.");
  if (existing.status !== "open") {
    throw new Error(`Task is ${existing.status}; only open tasks can be edited.`);
  }

  update.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", taskId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Push a task's due date out by `days`, counted from its current due date,
 *  or from today if it is overdue or has none — "+1 week" on something three
 *  weeks late should land a week from now, not two weeks ago. */
export async function bumpTask(taskId: string, days: number): Promise<Record<string, unknown>> {
  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, due_date")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!task) throw new Error("Task not found.");

  // Dan's "today", not UTC's — after 7pm Central the UTC date is already tomorrow.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const basis = task.due_date && task.due_date > today ? task.due_date : today;
  const next = addInterval(basis, "day", days);
  return updateTask(taskId, { due_date: next });
}
