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
