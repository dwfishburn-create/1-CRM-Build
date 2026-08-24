"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

// Link a property as a candidate on a project. Re-adding a property that's
// already linked just updates its status/notes (upsert on the
// project_id+property_id unique constraint) rather than erroring.
export async function addCandidateProperty(formData: FormData) {
  const project_id = String(formData.get("project_id") || "").trim();
  const property_id = String(formData.get("property_id") || "").trim();

  if (!project_id) throw new Error("project_id is required.");
  if (!property_id) throw new Error("Select a property.");

  const status = String(formData.get("status") || "").trim() || "candidate";
  const notes = String(formData.get("notes") || "").trim() || null;

  const { error } = await supabase
    .from("project_properties")
    .upsert(
      { project_id, property_id, status, notes },
      { onConflict: "project_id,property_id" }
    );

  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${project_id}`);
}

// Update a candidate link's status (Candidate/Toured/Selected/Rejected) as
// the search on a project progresses.
export async function updateCandidateStatus(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  const project_id = String(formData.get("project_id") || "").trim();
  const status = String(formData.get("status") || "").trim();

  if (!id) throw new Error("id is required.");
  if (!status) throw new Error("status is required.");

  const { error } = await supabase
    .from("project_properties")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${project_id}`);
}

export async function removeCandidateProperty(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  const project_id = String(formData.get("project_id") || "").trim();

  if (!id) throw new Error("id is required.");

  const { error } = await supabase
    .from("project_properties")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${project_id}`);
}
