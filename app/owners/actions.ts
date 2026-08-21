"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

export async function createOwner(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) throw new Error("Owner / entity name is required.");

  const entity_type = String(formData.get("entity_type") || "").trim() || null;
  const primary_contact_id_raw = String(
    formData.get("primary_contact_id") || ""
  ).trim();
  const primary_contact_id = primary_contact_id_raw || null;
  const notes = String(formData.get("notes") || "").trim() || null;

  const display_code = await nextDisplayCode("owners", "OWN");

  const { error } = await supabase.from("owners").insert({
    display_code,
    name,
    entity_type,
    primary_contact_id,
    notes,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/owners");
  revalidatePath("/");
}
