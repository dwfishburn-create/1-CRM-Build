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

// Link a contact to a project, replacing the log_activity-per-contact
// workaround (see the 8/30/2026 project_contacts decision). Re-linking a
// contact that's already on the project just updates role/notes (upsert on
// the project_id+contact_id unique constraint) rather than erroring.
export async function addProjectContact(formData: FormData) {
  const project_id = String(formData.get("project_id") || "").trim();
  const contact_id = String(formData.get("contact_id") || "").trim();

  if (!project_id) throw new Error("project_id is required.");
  if (!contact_id) throw new Error("Select a contact.");

  const role = String(formData.get("role") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const split_pct_raw = String(formData.get("split_pct") || "").trim();
  const split_pct = split_pct_raw ? Number(split_pct_raw) : null;

  const { error } = await supabase
    .from("project_contacts")
    .upsert(
      { project_id, contact_id, role, split_pct, notes },
      { onConflict: "project_id,contact_id" }
    );

  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${project_id}`);
}

// Link an entity (e.g. an outside brokerage or referral source) directly
// to a project as a collaborator, when there isn't yet a specific contact
// person there — see the 8/30/2026 project_collaborators decision, which
// extended project_contacts with entity_id + split_pct rather than adding
// a separate table. Re-linking an entity already on the project updates
// its role/split_pct/notes (upsert on the project_id+entity_id unique
// index) rather than erroring.
export async function addProjectCollaboratorEntity(formData: FormData) {
  const project_id = String(formData.get("project_id") || "").trim();
  const entity_id = String(formData.get("entity_id") || "").trim();

  if (!project_id) throw new Error("project_id is required.");
  if (!entity_id) throw new Error("Select an entity.");

  const role = String(formData.get("role") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const split_pct_raw = String(formData.get("split_pct") || "").trim();
  const split_pct = split_pct_raw ? Number(split_pct_raw) : null;

  const { error } = await supabase
    .from("project_contacts")
    .upsert(
      { project_id, entity_id, role, split_pct, notes },
      { onConflict: "project_id,entity_id" }
    );

  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${project_id}`);
}

export async function removeProjectContact(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  const project_id = String(formData.get("project_id") || "").trim();

  if (!id) throw new Error("id is required.");

  const { error } = await supabase
    .from("project_contacts")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${project_id}`);
}

// Log a structured reference link (a marketing-package URL, a standing
// deal-terms answer, etc.) against this project, replacing the
// activity_log-note workaround (see the 8/30/2026 reference_links decision).
export async function addReferenceLink(formData: FormData) {
  const project_id = String(formData.get("project_id") || "").trim();
  const label = String(formData.get("label") || "").trim();

  if (!project_id) throw new Error("project_id is required.");
  if (!label) throw new Error("Label is required.");

  const url = String(formData.get("url") || "").trim() || null;
  const link_type = String(formData.get("link_type") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;

  const { error } = await supabase.from("reference_links").insert({
    project_id,
    label,
    url,
    link_type,
    notes,
  });

  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${project_id}`);
}

export async function removeReferenceLink(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  const project_id = String(formData.get("project_id") || "").trim();

  if (!id) throw new Error("id is required.");

  const { error } = await supabase
    .from("reference_links")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${project_id}`);
}
