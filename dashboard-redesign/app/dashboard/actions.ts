"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { bumpTask, completeTask, updateTask } from "@/lib/tasks";

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
