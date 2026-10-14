"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { signalFieldsFromForm, syncReconfirmTaskSafe } from "@/lib/requirementReconfirm";
import type { FormResult } from "@/app/_components/ActionForm";

function revalidateRequirement(id: string) {
  revalidatePath(`/requirements/${id}`);
  revalidatePath("/requirements");
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  revalidatePath("/directory");
}

// Edit every field of a requirement from its page (10/13/2026). Before this
// the page could only change status; the Agent API's PATCH could do the rest.
// The form posts every field, so a blank field clears it. Errors (a bad date,
// a number that isn't one) show in place via ActionForm.
export async function updateRequirement(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const fail = (m: string): FormResult => ({ ok: false, error: m, at: Date.now() });
  try {
    const id = String(fd.get("id") || "").trim();
    if (!id) return fail("id is required.");

    const text = (k: string) => String(fd.get(k) || "").trim() || null;
    const num = (k: string): number | null => {
      const raw = String(fd.get(k) || "").replace(/[,\s$]/g, "");
      if (!raw) return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`${k.replace("_", " ")} must be a number.`);
      return n;
    };

    const status = text("status") ?? "active";
    const patch: Record<string, unknown> = {
      deal_type: text("deal_type"),
      property_type: text("property_type"),
      target_location: text("target_location"),
      timeline: text("timeline"),
      status,
      priority: text("priority"),
      details: text("details"),
      source: text("source"),
      size_min: num("size_min"),
      size_max: num("size_max"),
      budget_min: num("budget_min"),
      budget_max: num("budget_max"),
      ...signalFieldsFromForm(fd),
      updated_at: new Date().toISOString(),
    };

    // The form always posts every field, so whether status or the reconfirm
    // date actually changed is worked out against the stored row — an edit to
    // the details must not resurrect a re-confirm Dan already completed.
    const { data: before, error: readErr } = await supabase
      .from("requirements")
      .select("status, reconfirm_date")
      .eq("id", id)
      .maybeSingle();
    if (readErr) return fail(readErr.message);
    if (!before) return fail("Requirement not found.");

    const { error } = await supabase.from("requirements").update(patch).eq("id", id);
    if (error) return fail(error.message);

    const reconfirm = await syncReconfirmTaskSafe(id, {
      createIfMissing: before.status !== status || (before.reconfirm_date ?? null) !== (patch.reconfirm_date ?? null),
    });
    revalidateRequirement(id);
    return { ok: true, warning: reconfirm.reconfirm_warning, at: Date.now() };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export async function updateRequirementStatus(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  const status = String(formData.get("status") || "").trim();

  if (!id) throw new Error("id is required.");
  if (!status) throw new Error("status is required.");

  const { data: before } = await supabase
    .from("requirements")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("requirements")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(error.message);

  // Leaving 'active' cancels the open re-confirm task; returning to it
  // re-creates one if a reconfirm date is set (lib/requirementReconfirm.ts).
  await syncReconfirmTaskSafe(id, { createIfMissing: before?.status !== status });
  revalidateRequirement(id);
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

  // Re-title an open re-confirm task to name the brand just linked.
  if (entity_id) await syncReconfirmTaskSafe(requirement_id, { createIfMissing: false });

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
