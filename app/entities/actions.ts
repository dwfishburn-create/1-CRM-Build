"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";

// Entities replaces the old separate Owners + Companies tables. Any
// business, LLC, trust, or individual lives here once — whether it's an
// "owner" or a "tenant" (or both) is determined by how it links to a
// property (property_owner / property_tenant), not by which table it's in.
export async function createEntity(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) throw new Error("Entity name is required.");

  const entity_type = String(formData.get("entity_type") || "").trim() || null;
  const industry = String(formData.get("industry") || "").trim() || null;
  const website = String(formData.get("website") || "").trim() || null;
  const primary_contact_id_raw = String(
    formData.get("primary_contact_id") || ""
  ).trim();
  const primary_contact_id = primary_contact_id_raw || null;
  const notes = String(formData.get("notes") || "").trim() || null;

  const display_code = await nextDisplayCode("entities", "ENT");

  const { error } = await supabase.from("entities").insert({
    display_code,
    name,
    entity_type,
    industry,
    website,
    primary_contact_id,
    notes,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/entities");
  revalidatePath("/contacts");
  revalidatePath("/");
}
