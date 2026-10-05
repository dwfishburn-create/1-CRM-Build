"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";
import { webLookalikes } from "@/lib/nearMatch";
import type { FormResult } from "../_components/ActionForm";

// Returns a FormResult (10/5/2026): a look-alike of an existing contact is
// shown with links and needs "create it anyway"; errors show in place.
export async function createContact(_prev: FormResult, formData: FormData): Promise<FormResult> {
  try {
    return await createContactInner(formData);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), at: Date.now() };
  }
}

async function createContactInner(formData: FormData): Promise<FormResult> {
  const first_name = String(formData.get("first_name") || "").trim();
  const last_name = String(formData.get("last_name") || "").trim();
  const email = String(formData.get("email") || "").trim() || null;
  const phone = String(formData.get("phone") || "").trim() || null;
  const mobile_phone =
    String(formData.get("mobile_phone") || "").trim() || null;
  const title = String(formData.get("title") || "").trim() || null;
  const company_name = String(formData.get("company_name") || "").trim();
  const notes = String(formData.get("notes") || "").trim() || null;

  if (!first_name && !last_name) {
    throw new Error("First or last name is required.");
  }

  if (formData.get("allow_duplicate") !== "true") {
    const matches = await webLookalikes("contact", {
      p_first: first_name || null,
      p_last: last_name || null,
      p_email: email,
      p_limit: 5,
    });
    if (matches.length) {
      return {
        ok: false,
        error: "This looks like a contact already in the CRM. Nothing was created — open it below, or tick the box to add it anyway.",
        matches,
        at: Date.now(),
      };
    }
  }

  // "Company" here means an entity in the unified entities table (which
  // replaced the old separate owners/companies tables) — a contact's
  // employer/affiliated business, looked up or created by name.
  let entity_id: string | null = null;
  if (company_name) {
    const { data: existing, error: lookupError } = await supabase
      .from("entities")
      .select("id")
      .ilike("name", company_name)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);

    if (existing) {
      entity_id = existing.id;
    } else {
      const entityCode = await nextDisplayCode("entities", "ENT");
      const { data: newEntity, error: entityError } = await supabase
        .from("entities")
        .insert({ name: company_name, display_code: entityCode })
        .select("id")
        .single();
      if (entityError) throw new Error(entityError.message);
      entity_id = newEntity.id;
    }
  }

  const display_code = await nextDisplayCode("contacts", "CON");

  const { error } = await supabase.from("contacts").insert({
    display_code,
    first_name: first_name || null,
    last_name: last_name || null,
    email,
    phone,
    mobile_phone,
    title,
    entity_id,
    notes,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/contacts");
  revalidatePath("/");
  return { ok: true, at: Date.now() };
}
