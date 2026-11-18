"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";
import {
  CAMPAIGN_STATUSES,
  PROSPECT_SOURCES,
  PROSPECT_STAGES,
  QUICK_LOG,
} from "@/lib/prospectChecklist";
import type { FormResult } from "@/app/_components/ActionForm";

// Server actions for the Prospect Checklist (11/18/2026, migration 039).
// Quick-log goes through lib/activity.ts like every other activity, so a
// follow-up date becomes a Your Move task on the Dashboard.

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}
function failed(e: unknown): FormResult {
  return { ok: false, error: e instanceof Error ? e.message : String(e), at: Date.now() };
}
function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/prospects`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
}

export async function quickLogProspectAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const project_id = str(fd, "project_id");
  const contact_id = str(fd, "contact_id");
  const project_contact_id = str(fd, "project_contact_id");
  const kind = QUICK_LOG.find((q) => q.key === str(fd, "kind"));
  if (!project_id || !contact_id) return failed(new Error("This prospect has no contact record to log against."));
  if (!kind) return failed(new Error("Pick call, text, LM, no answer, talked or pass."));

  const note = str(fd, "note");
  const followUp = str(fd, "follow_up_date");
  const name = str(fd, "name") || "prospect";
  try {
    const result = await logActivity({
      activity_type: kind.type,
      project_id,
      contact_id,
      activity_date: str(fd, "activity_date") || null,
      summary: note || `${kind.label}.`,
      next_step: followUp ? str(fd, "next_step") || `Follow up with ${name}` : null,
      next_step_due_date: followUp || null,
      performed_by: "Dan",
      source: "web — prospect checklist",
    });
    if (kind.key === "pass" && project_contact_id) {
      const { error } = await supabase
        .from("project_contacts")
        .update({ prospect_stage: "passed" })
        .eq("id", project_contact_id);
      if (error) return { ok: true, warning: `Logged, but the stage was not set to Passed: ${error.message}`, at: Date.now() };
    }
    refresh(project_id);
    return { ok: true, warning: result.task_warning, at: Date.now() };
  } catch (e) {
    return failed(e);
  }
}

const FIELDS = {
  prospect_stage: PROSPECT_STAGES.map((s) => s.value as string),
  prospect_source: PROSPECT_SOURCES.map((s) => s.value as string),
} as const;

export async function setProspectFieldAction(fd: FormData) {
  const project_id = str(fd, "project_id");
  const id = str(fd, "project_contact_id");
  const field = str(fd, "field") as keyof typeof FIELDS;
  const value = str(fd, "value");
  if (!id || !(field in FIELDS)) throw new Error("Unknown checklist field.");
  if (value && !FIELDS[field].includes(value)) throw new Error(`${value} is not an allowed value.`);
  const { error } = await supabase
    .from("project_contacts")
    .update({ [field]: value || null })
    .eq("id", id);
  if (error) throw new Error(error.message);
  refresh(project_id);
}

export async function setCampaignStatusAction(fd: FormData) {
  const project_id = str(fd, "project_id");
  const campaign_id = str(fd, "campaign_id");
  const project_contact_id = str(fd, "project_contact_id");
  const status = str(fd, "status");
  if (!campaign_id || !project_contact_id) throw new Error("campaign_id and project_contact_id are required.");
  if (!status) {
    const { error } = await supabase
      .from("project_campaign_recipients")
      .delete()
      .eq("campaign_id", campaign_id)
      .eq("project_contact_id", project_contact_id);
    if (error) throw new Error(error.message);
  } else {
    if (!CAMPAIGN_STATUSES.some((s) => s.value === status)) throw new Error(`${status} is not a campaign status.`);
    const { error } = await supabase
      .from("project_campaign_recipients")
      .upsert(
        { campaign_id, project_contact_id, status, updated_at: new Date().toISOString() },
        { onConflict: "campaign_id,project_contact_id" }
      );
    if (error) throw new Error(error.message);
  }
  refresh(project_id);
}

export async function addCampaignAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const project_id = str(fd, "project_id");
  const name = str(fd, "name");
  if (!project_id || !name) return failed(new Error("Give the campaign a name."));
  const { error } = await supabase
    .from("project_campaigns")
    .insert({ project_id, name, sent_on: str(fd, "sent_on") || null, notes: str(fd, "notes") || null });
  if (error) return failed(new Error(error.code === "23505" ? `There is already a campaign called "${name}" on this listing.` : error.message));
  refresh(project_id);
  return { ok: true, at: Date.now() };
}

// Signed CA received (migration 040). Saving a date also moves an earlier
// stage (cold … CA pending) up to "CA signed"; later stages are left alone.
const BEFORE_CA = ["cold", "contacted", "brochure_sent", "ca_pending"];

export async function setSignedCaAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const project_id = str(fd, "project_id");
  const id = str(fd, "project_contact_id");
  const signed = str(fd, "ca_signed_on");
  if (!id) return failed(new Error("project_contact_id is required."));
  if (signed && !/^\d{4}-\d{2}-\d{2}$/.test(signed)) return failed(new Error("Pick the date the signed CA came back."));
  const { data: cur, error: rErr } = await supabase
    .from("project_contacts").select("prospect_stage").eq("id", id).maybeSingle();
  if (rErr) return failed(new Error(rErr.message));
  const patch: Record<string, unknown> = { ca_signed_on: signed || null, ca_note: str(fd, "ca_note") || null };
  if (signed && (!cur?.prospect_stage || BEFORE_CA.includes(cur.prospect_stage))) patch.prospect_stage = "ca_signed";
  const { error } = await supabase.from("project_contacts").update(patch).eq("id", id);
  if (error) return failed(new Error(error.message));
  refresh(project_id);
  return { ok: true, at: Date.now() };
}
