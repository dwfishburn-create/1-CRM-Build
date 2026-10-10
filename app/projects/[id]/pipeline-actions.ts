"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import type { FormResult } from "@/app/_components/ActionForm";
import { FEE_BASES, PARTICIPANT_ROLES, RESULTS, numField } from "@/lib/pipeline";

// Pipeline actions on the deal page (Build #2, 10/10/2026). Every action
// returns a FormResult so a rejected save shows in place and keeps what was
// typed (the 10/5/2026 form rule) — none of them throw to the page.

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}
function fail(msg: string): FormResult {
  return { ok: false, error: msg, at: Date.now() };
}
function ok(warning?: string): FormResult {
  return { ok: true, warning, at: Date.now() };
}
function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/projects");
}
function isDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

type ParticipantInput = {
  contact_id: string | null;
  entity_id: string | null;
  party_name: string | null;
  role: string;
  split_pct: number | null;
  off_the_top: boolean;
};

// A participant row arrives as party_<i> ("c:<uuid>", "e:<uuid>" or blank),
// name_<i> (free text, for someone not on file), role_<i>, split_<i>, top_<i>.
// A row with no party and no name is ignored. Returns an error string on a
// bad row.
function readParticipants(fd: FormData, prefix = ""): ParticipantInput[] | string {
  const out: ParticipantInput[] = [];
  for (let i = 0; i < 10; i++) {
    const party = str(fd, `${prefix}party_${i}`);
    const name = str(fd, `${prefix}name_${i}`);
    const splitRaw = fd.get(`${prefix}split_${i}`);
    if (!party && !name) {
      if (String(splitRaw ?? "").trim()) return `Row ${i + 1} has a split but no party — pick one or type a name.`;
      continue;
    }
    const role = str(fd, `${prefix}role_${i}`) || "other";
    if (!PARTICIPANT_ROLES.some((r) => r.value === role)) return `Row ${i + 1}: unknown role.`;
    const split = numField(splitRaw);
    if (split !== null && (Number.isNaN(split) || split < 0 || split > 100)) {
      return `Row ${i + 1}: split must be a percent between 0 and 100.`;
    }
    out.push({
      contact_id: party.startsWith("c:") ? party.slice(2) : null,
      entity_id: party.startsWith("e:") ? party.slice(2) : null,
      party_name: party ? null : name,
      role,
      split_pct: split,
      off_the_top: fd.get(`${prefix}top_${i}`) === "on",
    });
  }
  return out;
}

/**
 * Save the deal's pipeline numbers. Used by both the first-open setup prompt
 * (mode=setup, which also takes participant rows and stamps
 * pipeline_setup_at) and the always-available edit form.
 * Blank stays blank — the 10/6 rule is "blank is better than a guess."
 */
export async function savePipelineAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const id = str(fd, "project_id");
  if (!id) return fail("Missing project.");
  const setup = str(fd, "mode") === "setup";

  const fee_basis = str(fd, "fee_basis") || null;
  if (fee_basis && !FEE_BASES.some((f) => f.value === fee_basis)) return fail("Unknown fee basis.");

  const deal_price = numField(fd.get("deal_price"));
  const commission_rate = numField(fd.get("commission_rate"));
  const dan_share_pct = numField(fd.get("dan_share_pct"));
  const probability_pct = numField(fd.get("probability_pct"));
  for (const [label, v] of [
    [fee_basis === "flat_fee" ? "Fee" : "Basis amount", deal_price],
    ["Rate", commission_rate],
    ["Your share", dan_share_pct],
    ["Probability", probability_pct],
  ] as const) {
    if (v !== null && Number.isNaN(v)) return fail(`${label} must be a number.`);
  }
  if (dan_share_pct !== null && (dan_share_pct < 0 || dan_share_pct > 100)) return fail("Your share must be between 0 and 100%.");
  if (probability_pct !== null && (probability_pct < 0 || probability_pct > 100)) return fail("Probability must be between 0 and 100%.");
  if (commission_rate !== null && (commission_rate < 0 || commission_rate > 100)) return fail("Rate must be a percent, e.g. 6 for 6%.");

  const target_close_date = str(fd, "target_close_date") || null;
  if (target_close_date && !isDate(target_close_date)) return fail("Expected close must be a date.");

  const patch: Record<string, unknown> = {
    fee_basis,
    deal_price,
    commission_rate: fee_basis === "flat_fee" ? null : commission_rate,
    dan_share_pct,
    probability_pct,
    target_close_date,
  };

  if (fd.has("result")) {
    const result = str(fd, "result") || "active";
    if (!RESULTS.some((r) => r.value === result)) return fail("Unknown result.");
    const result_date = str(fd, "result_date") || null;
    if (result_date && !isDate(result_date)) return fail("Result date must be a date.");
    patch.result = result;
    patch.result_date = result === "active" ? null : result_date;
    patch.result_note = str(fd, "result_note") || null;
  }
  if (fd.has("strategic_weight_note")) {
    patch.strategic_weight_note = str(fd, "strategic_weight_note") || null;
  }

  let participants: ParticipantInput[] = [];
  if (setup) {
    const parsed = readParticipants(fd);
    if (typeof parsed === "string") return fail(parsed);
    participants = parsed;
    patch.pipeline_setup_at = new Date().toISOString();
  }

  const { error } = await supabase.from("projects").update(patch).eq("id", id);
  if (error) return fail(error.message);

  let warning: string | undefined;
  if (participants.length > 0) {
    const { error: pErr } = await supabase
      .from("project_commission_participants")
      .insert(participants.map((p) => ({ ...p, project_id: id })));
    if (pErr) warning = `Deal saved, but the split rows were not: ${pErr.message}`;
  }

  refresh(id);
  return ok(warning);
}

export async function addParticipantAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const id = str(fd, "project_id");
  if (!id) return fail("Missing project.");
  const parsed = readParticipants(fd);
  if (typeof parsed === "string") return fail(parsed);
  if (parsed.length === 0) return fail("Pick a party or type a name.");
  const { error } = await supabase
    .from("project_commission_participants")
    .insert(parsed.map((p) => ({ ...p, project_id: id })));
  if (error) return fail(error.message);
  refresh(id);
  return ok();
}

export async function removeParticipantAction(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  const projectId = str(fd, "project_id");
  if (!id) return;
  await supabase.from("project_commission_participants").delete().eq("id", id);
  if (projectId) refresh(projectId);
}

export async function addPaymentAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const project_id = str(fd, "project_id");
  if (!project_id) return fail("Missing project.");
  const label = str(fd, "label");
  if (!label) return fail("Give the payment a name, e.g. Payment 1.");
  const amount = numField(fd.get("amount"));
  if (amount !== null && Number.isNaN(amount)) return fail("Amount must be a number.");
  const earned_date = str(fd, "earned_date") || null;
  if (earned_date && !isDate(earned_date)) return fail("Earned date must be a date.");
  const due_note = str(fd, "due_note") || null;
  if (!earned_date && !due_note) return fail("Add the date it's earned, or a note on when it comes due (e.g. Lease Year 6).");
  const { error } = await supabase.from("commission_payments").insert({
    project_id,
    label,
    amount,
    earned_date,
    due_note,
    notes: str(fd, "notes") || null,
  });
  if (error) return fail(error.message);
  refresh(project_id);
  return ok();
}

export async function receivePaymentAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const id = str(fd, "id");
  const project_id = str(fd, "project_id");
  if (!id) return fail("Missing payment.");
  const received_date = str(fd, "received_date");
  if (!isDate(received_date)) return fail("Enter the date it was received.");
  const received_amount = numField(fd.get("received_amount"));
  if (received_amount !== null && Number.isNaN(received_amount)) return fail("Amount must be a number.");
  const { error } = await supabase
    .from("commission_payments")
    .update({ received_date, received_amount, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return fail(error.message);
  if (project_id) refresh(project_id);
  revalidatePath("/dashboard");
  return ok();
}

export async function removePaymentAction(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  const projectId = str(fd, "project_id");
  if (!id) return;
  await supabase.from("commission_payments").delete().eq("id", id);
  if (projectId) refresh(projectId);
}
