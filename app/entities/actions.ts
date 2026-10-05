"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";
import { webLookalikes } from "@/lib/nearMatch";
import type { FormResult } from "../_components/ActionForm";

// Entities replaces the old separate Owners + Companies tables. Any
// business, LLC, trust, or individual lives here once — whether it's an
// "owner" or a "tenant" (or both) is determined by how it links to a
// property (property_owner / property_tenant), not by which table it's in.
// Returns a FormResult (10/5/2026): a look-alike of an existing entity is
// shown with links and needs "create it anyway"; errors show in place.
export async function createEntity(_prev: FormResult, formData: FormData): Promise<FormResult> {
  try {
    return await createEntityInner(formData);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), at: Date.now() };
  }
}

async function createEntityInner(formData: FormData): Promise<FormResult> {
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

  if (formData.get("allow_duplicate") !== "true") {
    const matches = await webLookalikes("entity", { p_name: name, p_limit: 5 });
    if (matches.length) {
      return {
        ok: false,
        error: "This looks like an entity already in the CRM. Nothing was created — open it below, or tick the box to add it anyway.",
        matches,
        at: Date.now(),
      };
    }
  }

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
  return { ok: true, at: Date.now() };
}
