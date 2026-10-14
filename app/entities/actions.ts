"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { nextDisplayCode } from "@/lib/displayCode";
import { webLookalikes } from "@/lib/nearMatch";
import type { FormResult } from "../_components/ActionForm";
import { BRAND_FIELDS, createBrand, markVerified, updateBrand } from "@/lib/retailBrands";
import { todayCentral } from "@/lib/centralDate";

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

// ---------------------------------------------------------------------------
// Retail Tenant Directory (10/13/2026, migration 026). The brand profile on
// /entities/[id]. Validation is lib/retailBrands.ts — the same code the Agent
// API runs — so a value outside a closed list is refused with the same
// message here as there, shown in place by ActionForm.
// ---------------------------------------------------------------------------

function brandFailed(e: unknown): FormResult {
  return { ok: false, error: e instanceof Error ? e.message : String(e), at: Date.now() };
}

// Only fields the form actually carries are sent (PATCH semantics). The
// checkbox groups post nothing when all are unticked, so the edit form adds a
// hidden "<field>__present" marker to say "this list was on the form".
function brandInputFromForm(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of BRAND_FIELDS) {
    if (field === "facility_types" || field === "target_markets") {
      if (fd.has(field) || fd.has(`${field}__present`)) {
        out[field] = fd.getAll(field).map((v) => String(v));
      }
    } else if (fd.has(field)) {
      out[field] = String(fd.get(field) ?? "");
    }
  }
  return out;
}

function refreshBrand(entityId: string) {
  revalidatePath(`/entities/${entityId}`);
  revalidatePath("/directory");
}

export async function createBrandProfile(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const entityId = String(fd.get("entity_id") || "").trim();
  try {
    await createBrand(entityId, brandInputFromForm(fd));
    refreshBrand(entityId);
    return { ok: true, at: Date.now() };
  } catch (e) {
    return brandFailed(e);
  }
}

export async function updateBrandProfile(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const id = String(fd.get("brand_id") || "").trim();
  const entityId = String(fd.get("entity_id") || "").trim();
  try {
    await updateBrand({ id }, brandInputFromForm(fd));
    refreshBrand(entityId);
    return { ok: true, at: Date.now() };
  } catch (e) {
    return brandFailed(e);
  }
}

export async function markBrandVerified(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const id = String(fd.get("brand_id") || "").trim();
  const entityId = String(fd.get("entity_id") || "").trim();
  try {
    await markVerified(id, String(fd.get("verification_note") || ""));
    refreshBrand(entityId);
    return { ok: true, at: Date.now() };
  } catch (e) {
    return brandFailed(e);
  }
}

// Mark a contact<->entity link former (or current again) — job history, the
// link itself is kept. Marking former stamps ended_on with today (Central)
// unless one is already recorded; marking current again clears it.
export async function setAffiliationCurrent(fd: FormData) {
  const id = String(fd.get("id") || "").trim();
  const entityId = String(fd.get("entity_id") || "").trim();
  const current = String(fd.get("is_current") || "") === "true";
  if (!id) throw new Error("id is required.");

  const update: Record<string, unknown> = { is_current: current, updated_at: new Date().toISOString() };
  if (current) {
    update.ended_on = null;
  } else {
    const { data } = await supabase.from("contact_entities").select("ended_on").eq("id", id).maybeSingle();
    if (!data?.ended_on) update.ended_on = todayCentral();
  }
  const { error } = await supabase.from("contact_entities").update(update).eq("id", id);
  if (error) throw new Error(error.message);
  refreshBrand(entityId);
}
