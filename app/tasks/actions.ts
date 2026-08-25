"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";
import { completeTask, cancelTask, type RecurrenceUnit } from "@/lib/tasks";

const RECURRENCE_UNITS: RecurrenceUnit[] = ["none", "day", "week", "month", "year"];

// A task can stand entirely alone (Dan's own example: a license renewal
// reminder with no CRM entity attached) — every link below is optional. See
// CRM_Requirements_and_Decisions_Log.md, 8/23/2026 entry.
export async function createTask(formData: FormData) {
  const description = String(formData.get("description") || "").trim();
  if (!description) throw new Error("description is required.");

  const due_date = String(formData.get("due_date") || "").trim() || null;
  const category = String(formData.get("category") || "").trim() || null;

  const property_id = String(formData.get("property_id") || "").trim() || null;
  const project_id = String(formData.get("project_id") || "").trim() || null;
  const contact_id = String(formData.get("contact_id") || "").trim() || null;
  const entity_id = String(formData.get("entity_id") || "").trim() || null;
  const requirement_id = String(formData.get("requirement_id") || "").trim() || null;
  const waiting_on_contact_id =
    String(formData.get("waiting_on_contact_id") || "").trim() || null;

  const recurrence_unit_raw = String(formData.get("recurrence_unit") || "none").trim();
  const recurrence_unit: RecurrenceUnit = RECURRENCE_UNITS.includes(
    recurrence_unit_raw as RecurrenceUnit
  )
    ? (recurrence_unit_raw as RecurrenceUnit)
    : "none";
  const recurrence_interval_raw = String(formData.get("recurrence_interval") || "1").trim();
  const recurrence_interval = Math.max(1, Number(recurrence_interval_raw) || 1);

  const display_code = await nextDisplayCode("tasks", "TASK");

  const { error } = await supabase.from("tasks").insert({
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
  });

  if (error) throw new Error(error.message);

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/");
}

export async function completeTaskAction(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  if (!id) throw new Error("id is required.");

  await completeTask(id);

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/");
}

export async function cancelTaskAction(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  if (!id) throw new Error("id is required.");

  await cancelTask(id);

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/");
}
