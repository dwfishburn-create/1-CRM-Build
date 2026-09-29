import { supabase } from "./supabase";
import { nextDisplayCode } from "./displayCode";
import { provenance } from "./provenance";

// Project deadlines (migration 022, 9/29/2026). One place for the writes, used
// by the Agent API route, the project page and the Dashboard, matching the
// lib/tasks.ts pattern.
//
// Derived dates (LA expiration -> tail end and Existing Prospect List due;
// PA effective -> deposit due) are created and kept in step by triggers in the
// database, so every write path gets them — nothing here re-implements them.

export const DEADLINE_SELECT =
  "*, type:deadline_types!deadline_type(code, label, family, is_money, derive_from), " +
  "project:projects!project_id(id, project_code, client_name, status), " +
  "derived_from:project_deadlines!derived_from_id(id, display_code, deadline_type, deadline_date)";

export type DeadlineInput = {
  project_id: string;
  deadline_type: string;
  deadline_date?: string | null;
  amount?: number | null;
  notes?: string | null;
  source_document?: string | null;
  is_completed?: boolean;
  /** PA effective only: the days the purchase agreement gives for the deposit. */
  deposit_offset_days?: number | null;
  source_system?: string;
  source_record_id?: string;
  source_batch_id?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanDate(v: unknown, field: string): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!DATE_RE.test(s)) throw new Error(`${field} must be YYYY-MM-DD.`);
  return s;
}

function cleanNumber(v: unknown, field: string): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`${field} must be a number.`);
  return n;
}

function cleanText(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

export async function listDeadlineTypes() {
  const [{ data: types, error }, { data: rules, error: rulesError }] = await Promise.all([
    supabase.from("deadline_types").select("*").order("sort_order"),
    supabase.from("deadline_warning_rules").select("source_kind, type_key, lead, lead_label"),
  ]);
  if (error) throw new Error(error.message);
  if (rulesError) throw new Error(rulesError.message);
  return (types ?? []).map((t) => ({
    ...t,
    warnings: (rules ?? [])
      .filter((r) => r.source_kind === "project_deadline" && r.type_key === t.code)
      .map((r) => r.lead_label),
  }));
}

export async function createDeadline(input: DeadlineInput & Record<string, unknown>) {
  const project_id = String(input.project_id || "").trim();
  const deadline_type = String(input.deadline_type || "").trim();
  if (!project_id) throw new Error("project_id is required.");
  if (!deadline_type) throw new Error("deadline_type is required.");

  const deadline_date = cleanDate(input.deadline_date, "deadline_date");
  const amount = cleanNumber(input.amount, "amount");
  const offset = cleanNumber(input.deposit_offset_days, "deposit_offset_days");
  if (offset !== null && deadline_type !== "pa_effective") {
    throw new Error("deposit_offset_days applies only to a pa_effective deadline.");
  }
  if (offset !== null && (offset < 0 || !Number.isInteger(offset))) {
    throw new Error("deposit_offset_days must be a whole number of days.");
  }

  const display_code = await nextDisplayCode("project_deadlines", "DL");
  const { data, error } = await supabase
    .from("project_deadlines")
    .insert({
      ...provenance(input),
      display_code,
      project_id,
      deadline_type,
      deadline_date,
      amount,
      notes: cleanText(input.notes),
      source_document: cleanText(input.source_document),
      is_completed: Boolean(input.is_completed),
    })
    .select("id")
    .single();
  if (error) {
    if (error.message.includes("deadline_types")) {
      throw new Error(
        `Unknown deadline_type "${deadline_type}". Call list_deadlines with include_types for the list.`
      );
    }
    throw new Error(error.message);
  }

  // The trigger has created the derived deposit row; dating it is one update.
  if (offset !== null) {
    const { error: offErr } = await supabase
      .from("project_deadlines")
      .update({ offset_days: offset, updated_at: new Date().toISOString() })
      .eq("derived_from_id", data.id)
      .eq("deadline_type", "deposit_due");
    if (offErr) throw new Error(offErr.message);
  }

  return getDeadlineWithChildren(data.id);
}

async function getDeadlineWithChildren(id: string) {
  const { data, error } = await supabase
    .from("project_deadlines")
    .select(DEADLINE_SELECT)
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  const { data: derived } = await supabase
    .from("project_deadlines")
    .select("id, display_code, deadline_type, deadline_date, offset_days, notes")
    .eq("derived_from_id", id);
  return { deadline: data, derived: derived ?? [] };
}

const EDITABLE_TEXT = ["deadline_type", "notes", "source_document"] as const;

/**
 * Only the fields present change; "" clears a clearable field. Setting
 * deadline_date directly on a derived row marks it overridden, so a later move
 * of its anchor no longer rewrites it. Setting offset_days on a derived row
 * re-dates it from its anchor.
 */
export async function updateDeadline(id: string, patch: Record<string, unknown>) {
  if (!id) throw new Error("id is required.");
  const { data: existing, error: fetchError } = await supabase
    .from("project_deadlines")
    .select("id, derived_from_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!existing) throw new Error("Deadline not found.");

  const update: Record<string, unknown> = {};
  for (const f of EDITABLE_TEXT) {
    if (f in patch) {
      const v = cleanText(patch[f]);
      if (f === "deadline_type" && !v) throw new Error("deadline_type cannot be cleared.");
      update[f] = v;
    }
  }
  if ("deadline_date" in patch) {
    update.deadline_date = cleanDate(patch.deadline_date, "deadline_date");
    if (existing.derived_from_id) update.date_overridden = true;
  }
  if ("amount" in patch) update.amount = cleanNumber(patch.amount, "amount");
  if ("offset_days" in patch) {
    const n = cleanNumber(patch.offset_days, "offset_days");
    if (n !== null && (n < 0 || !Number.isInteger(n))) throw new Error("offset_days must be a whole number of days.");
    update.offset_days = n;
    if (existing.derived_from_id) update.date_overridden = false;
  }
  if ("is_completed" in patch) update.is_completed = Boolean(patch.is_completed);

  if (Object.keys(update).length === 0) {
    throw new Error(
      "Provide at least one field to update: deadline_type, deadline_date, amount, offset_days, is_completed, notes, source_document."
    );
  }
  update.updated_at = new Date().toISOString();

  // offset first (its trigger re-dates the row), then everything else.
  if ("offset_days" in update) {
    const { error } = await supabase
      .from("project_deadlines")
      .update({ offset_days: update.offset_days, date_overridden: false })
      .eq("id", id);
    if (error) throw new Error(error.message);
    delete update.offset_days;
    delete update.date_overridden;
  }
  const { error } = await supabase.from("project_deadlines").update(update).eq("id", id);
  if (error) throw new Error(error.message);
  return getDeadlineWithChildren(id);
}

export async function setDeadlineCompleted(id: string, done: boolean) {
  const { error } = await supabase
    .from("project_deadlines")
    .update({ is_completed: done, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteDeadline(id: string) {
  const { error } = await supabase.from("project_deadlines").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Issue any warnings due today. Idempotent; returns how many were issued. */
export async function runDeadlineWarnings(): Promise<number> {
  const { data, error } = await supabase.rpc("generate_deadline_warnings");
  if (error) throw new Error(`Deadline warnings failed: ${error.message}`);
  return Number(data ?? 0);
}
