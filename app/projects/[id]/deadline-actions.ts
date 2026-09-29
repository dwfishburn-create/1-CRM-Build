"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import {
  createDeadline,
  deleteDeadline,
  runDeadlineWarnings,
  setDeadlineCompleted,
  updateDeadline,
} from "@/lib/deadlines";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/dashboard");
}

export async function addDeadline(fd: FormData) {
  const project_id = str(fd, "project_id");
  await createDeadline({
    project_id,
    deadline_type: str(fd, "deadline_type"),
    deadline_date: str(fd, "deadline_date") || null,
    amount: str(fd, "amount") ? Number(str(fd, "amount")) : null,
    deposit_offset_days: str(fd, "deposit_offset_days") ? Number(str(fd, "deposit_offset_days")) : null,
    source_document: str(fd, "source_document") || null,
    notes: str(fd, "notes") || null,
    is_completed: str(fd, "is_completed") === "on",
  });
  await runDeadlineWarnings();
  refresh(project_id);
}

export async function markDeadline(fd: FormData) {
  const id = str(fd, "id");
  const project_id = str(fd, "project_id");
  await setDeadlineCompleted(id, str(fd, "done") === "true");
  refresh(project_id);
}

export async function redateDeadline(fd: FormData) {
  const id = str(fd, "id");
  const project_id = str(fd, "project_id");
  const patch: Record<string, unknown> = {};
  if (fd.has("deadline_date")) patch.deadline_date = str(fd, "deadline_date");
  if (str(fd, "offset_days")) patch.offset_days = Number(str(fd, "offset_days"));
  await updateDeadline(id, patch);
  await runDeadlineWarnings();
  refresh(project_id);
}

export async function removeDeadline(fd: FormData) {
  const id = str(fd, "id");
  const project_id = str(fd, "project_id");
  await deleteDeadline(id);
  refresh(project_id);
}

export async function setProjectClient(fd: FormData) {
  const project_id = str(fd, "project_id");
  const client_entity_id = str(fd, "client_entity_id") || null;
  const { error } = await supabase
    .from("projects")
    .update({ client_entity_id, updated_at: new Date().toISOString() })
    .eq("id", project_id);
  if (error) throw new Error(error.message);
  refresh(project_id);
}
