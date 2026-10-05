"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { bumpTask, cancelTask, completeTask, updateTask } from "@/lib/tasks";
import { logActivity } from "@/lib/activity";
import { completeLeaseEvent } from "@/lib/leaseEvents";
import { setDeadlineCompleted } from "@/lib/deadlines";
import { todayCentral } from "@/lib/centralDate";

// Actions behind the redesigned Dashboard (9/26/2026). They go through the
// same lib/tasks functions the Agent API and record pages use.

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function refresh() {
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
}

export async function completeTaskFromDashboard(fd: FormData) {
  const id = str(fd, "id");
  if (!id) throw new Error("id is required.");
  await completeTask(id);
  refresh();
}

/** Re-date to a specific day. Only due_date changes. */
export async function redateTaskFromDashboard(fd: FormData) {
  const id = str(fd, "id");
  const due = str(fd, "due_date");
  if (!id) throw new Error("id is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error("Pick a date.");
  await updateTask(id, { due_date: due });
  refresh();
}

/** +N days from the due date, or from today if it is overdue. */
export async function bumpTaskFromDashboard(fd: FormData) {
  const id = str(fd, "id");
  const days = Number(str(fd, "days") || "7");
  if (!id) throw new Error("id is required.");
  await bumpTask(id, days);
  refresh();
}

/** "Got it" on the weekly Preview — retired for that week, on every device. */
export async function retirePreview(fd: FormData) {
  const week_start = str(fd, "week_start");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_start)) throw new Error("week_start is required.");
  const { error } = await supabase
    .from("dashboard_preview_dismissals")
    .upsert({ week_start, dismissed_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  refresh();
}

// ---------------------------------------------------------------------------
// Closing a task with a note (10/5/2026, Dan's ruling).
//
// "Mark done" used to close a task silently: the task was kept, but nothing
// recorded why — so "Hy-Vee isn't exercising the Birch option" would have
// vanished with one click. Now:
//   - Mark done and Cancel task each take an OPTIONAL one-line note. A note is
//     saved as an activity on the task's linked record (deal, property,
//     contact, company), so it shows in that record's history. No note, no
//     activity — routine tasks stay one click.
//   - Cancel is separate from Done: a task that turned out not to be needed
//     is cancelled, and the history shows the difference.
//   - "Lease date handled" / "Deadline handled" REQUIRE a note, because the
//     outcome (exercised or not, renewed or leaving) is the information. The
//     note goes into the activity log and onto the date's own notes.
// These actions never throw for a user mistake — a thrown server action
// renders "This page couldn't load" (see 10/5 form fix).
// ---------------------------------------------------------------------------

type TaskLinks = {
  id: string;
  display_code: string | null;
  title: string | null;
  description: string | null;
  project_id: string | null;
  property_id: string | null;
  contact_id: string | null;
  entity_id: string | null;
  waiting_on_contact_id: string | null;
};

async function taskLinks(id: string): Promise<TaskLinks | null> {
  const { data } = await supabase
    .from("tasks")
    .select("id, display_code, title, description, project_id, property_id, contact_id, entity_id, waiting_on_contact_id")
    .eq("id", id)
    .maybeSingle();
  return (data as TaskLinks | null) ?? null;
}

async function noteToHistory(task: TaskLinks | null, activity_type: string, note: string) {
  if (!note) return;
  const label = task ? `${task.display_code ?? "task"}: ${task.title ?? task.description ?? ""}`.trim() : "";
  try {
    await logActivity({
      activity_type,
      summary: label ? `${note}\n\n(${label})` : note,
      project_id: task?.project_id ?? null,
      property_id: task?.property_id ?? null,
      contact_id: task?.contact_id ?? task?.waiting_on_contact_id ?? null,
      entity_id: task?.entity_id ?? null,
      performed_by: "Dan",
      source: "web",
      create_task_from_next_step: false,
    });
  } catch (e) {
    // Closing the task matters more than the note; log and carry on.
    console.error("Dashboard note not saved:", e);
  }
}

export async function finishTaskDone(fd: FormData) {
  const id = str(fd, "id");
  if (!id) return;
  await noteToHistory(await taskLinks(id), "Task done", str(fd, "note"));
  await completeTask(id);
  refresh();
}

export async function finishTaskCancel(fd: FormData) {
  const id = str(fd, "id");
  if (!id) return;
  await noteToHistory(await taskLinks(id), "Task cancelled", str(fd, "note"));
  await cancelTask(id);
  refresh();
}

/** "Lease date handled" / "Deadline handled" — the outcome note is required. */
export async function handleDateFromDashboard(fd: FormData) {
  const taskId = str(fd, "task_id");
  const sourceId = str(fd, "source_id");
  const kind = str(fd, "kind");
  const note = str(fd, "note");
  if (!sourceId || !note || (kind !== "lease" && kind !== "deadline")) return;

  await noteToHistory(
    taskId ? await taskLinks(taskId) : null,
    kind === "lease" ? "Lease date handled" : "Deadline handled",
    note
  );

  const table = kind === "lease" ? "lease_events" : "project_deadlines";
  const stamp = `[Handled ${todayCentral()}] ${note}`;
  const { data: row } = await supabase.from(table).select("notes").eq("id", sourceId).maybeSingle();
  const prior = (row as { notes: string | null } | null)?.notes;
  await supabase
    .from(table)
    .update({ notes: prior ? `${prior}\n\n${stamp}` : stamp })
    .eq("id", sourceId);

  // Completing the date closes its warning task (migration 022's trigger).
  if (kind === "lease") await completeLeaseEvent(sourceId);
  else await setDeadlineCompleted(sourceId, true);
  refresh();
}
