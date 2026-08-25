"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function updateRequirementStatus(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  const status = String(formData.get("status") || "").trim();

  if (!id) throw new Error("id is required.");
  if (!status) throw new Error("status is required.");

  const { error } = await supabase
    .from("requirements")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath(`/requirements/${id}`);
  revalidatePath("/requirements");
}

// Link a contact or an entity (or both, via two separate calls) to a
// requirement. A single requirement can attach to any combination of
// contacts and entities at once — e.g. a decision-maker personally AND the
// company itself.
export async function addRequirementParty(formData: FormData) {
  const requirement_id = String(formData.get("requirement_id") || "").trim();
  const contact_id = String(formData.get("contact_id") || "").trim() || null;
  const entity_id = String(formData.get("entity_id") || "").trim() || null;

  if (!requirement_id) throw new Error("requirement_id is required.");
  if (!contact_id && !entity_id) {
    throw new Error("Select a contact or an entity to link.");
  }

  const { error } = await supabase.from("requirement_parties").insert({
    requirement_id,
    contact_id,
    entity_id,
  });

  if (error) throw new Error(error.message);

  revalidatePath(`/requirements/${requirement_id}`);
}

export async function removeRequirementParty(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  const requirement_id = String(formData.get("requirement_id") || "").trim();

  if (!id) throw new Error("id is required.");

  const { error } = await supabase
    .from("requirement_parties")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath(`/requirements/${requirement_id}`);
}
