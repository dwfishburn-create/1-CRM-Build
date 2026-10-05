"use server";

import { revalidatePath } from "next/cache";
import { logActivity, updateActivity, type ActivityPatch } from "@/lib/activity";
import { bumpTask, cancelTask, completeTask, updateTask } from "@/lib/tasks";
import type { FormResult } from "./ActionForm";

// Server actions for the Contact, Property and Entity pages (9/24/2026, fifth
// pass): log an activity and edit / re-date / close tasks without a chat.
// Every one of them goes through the same lib functions the Agent API uses.

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

// Revalidate the page the form was posted from plus the two screens that
// summarize tasks. Only an in-app path is accepted.
function refresh(fd: FormData) {
  const back = str(fd, "return_path");
  if (back.startsWith("/") && !back.startsWith("//")) revalidatePath(back);
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
}

// Log Activity / Correct return a FormResult instead of throwing (10/5/2026):
// ActionForm shows the message beside the form and keeps what Dan typed. A
// thrown error in a server action renders Next.js's "This page couldn't load".
function failed(e: unknown): FormResult {
  return { ok: false, error: e instanceof Error ? e.message : String(e), at: Date.now() };
}

export async function logActivityAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const activity_type = str(fd, "activity_type");
  if (!activity_type) return failed(new Error("Pick or type an activity type."));

  const next_step = str(fd, "next_step");
  const next_step_due_date = str(fd, "next_step_due_date");
  if (next_step_due_date && !next_step) {
    return failed(new Error("A follow-up date needs a next step to go with it. Add the next step, or clear the date."));
  }

  try {
    const result = await logActivity({
      activity_type,
      contact_id: str(fd, "contact_id") || null,
      entity_id: str(fd, "entity_id") || null,
      property_id: str(fd, "property_id") || null,
      project_id: str(fd, "project_id") || null,
      activity_date: str(fd, "activity_date") || null,
      summary: str(fd, "summary") || null,
      next_step: next_step || null,
      next_step_due_date: next_step_due_date || null,
      waiting_on_contact_id: str(fd, "waiting_on_contact_id") || null,
      performed_by: "Dan",
      source: "web",
    });
    refresh(fd);
    return { ok: true, warning: result.task_warning, at: Date.now() };
  } catch (e) {
    return failed(e);
  }
}

export async function updateTaskAction(fd: FormData) {
  const id = str(fd, "id");
  if (!id) throw new Error("id is required.");
  await updateTask(id, {
    description: str(fd, "description"),
    due_date: str(fd, "due_date"),
    waiting_on_contact_id: str(fd, "waiting_on_contact_id"),
  });
  refresh(fd);
}

export async function bumpTaskAction(fd: FormData) {
  const id = str(fd, "id");
  const days = Number(str(fd, "days") || "7");
  if (!id) throw new Error("id is required.");
  await bumpTask(id, days);
  refresh(fd);
}

export async function completeTaskFromRecord(fd: FormData) {
  const id = str(fd, "id");
  if (!id) throw new Error("id is required.");
  await completeTask(id);
  refresh(fd);
}

export async function cancelTaskFromRecord(fd: FormData) {
  const id = str(fd, "id");
  if (!id) throw new Error("id is required.");
  await cancelTask(id);
  refresh(fd);
}

// Correct an activity from the record pages (9/27/2026). Text fields and the
// contact link; the edit history is written by update_activity() in Postgres.
export async function updateActivityAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const id = str(fd, "id");
  if (!id) return failed(new Error("id is required."));
  const next_step = str(fd, "next_step");
  const next_step_due_date = str(fd, "next_step_due_date");
  if (next_step_due_date && !next_step) {
    return failed(new Error("A next step date needs a next step to go with it. Add the next step, or clear the date."));
  }
  // Only send the date if it was changed: re-sending an unchanged date would
  // reset the stored time of day to noon and log a false edit.
  const activity_date = str(fd, "activity_date");
  const patch: ActivityPatch = {
    activity_type: str(fd, "activity_type"),
    summary: str(fd, "summary"),
    next_step,
    next_step_due_date,
    contact_id: str(fd, "contact_id"),
  };
  if (activity_date && activity_date !== str(fd, "original_date")) patch.activity_date = activity_date;
  try {
    const result = await updateActivity(id, patch, { source: "web" });
    refresh(fd);
    return { ok: true, warning: result.task_warning ?? result.note, at: Date.now() };
  } catch (e) {
    return failed(e);
  }
}
