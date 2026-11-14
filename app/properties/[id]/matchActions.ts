"use server";

import { revalidatePath } from "next/cache";
import { createMatchTasks } from "@/lib/requirementMatch";

// "Create tasks for strong matches" on the property page (Phase 4, 11/14/2026).
// Same de-duplicated path the Listing Intake Sweep uses through
// find_requirement_matches(create_tasks: true).
export async function createMatchTasksAction(formData: FormData) {
  const id = String(formData.get("property_id") || "").trim();
  if (!id) throw new Error("property_id is required.");
  await createMatchTasks(id);
  revalidatePath(`/properties/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
}
