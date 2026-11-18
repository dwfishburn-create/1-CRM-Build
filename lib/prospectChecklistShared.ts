// Prospect Checklist — constants, labels and pure helpers (11/18/2026).
// Kept apart from lib/prospectChecklist.ts so client components can import
// them: that file pulls in the server-only Supabase client, which throws in
// the browser.

export const PROSPECT_STAGES = [
  { value: "cold", label: "Cold" },
  { value: "contacted", label: "Contacted" },
  { value: "brochure_sent", label: "Brochure sent" },
  { value: "ca_pending", label: "CA pending" },
  { value: "ca_signed", label: "CA signed" },
  { value: "package_sent", label: "Package sent" },
  { value: "touring", label: "Touring" },
  { value: "offer", label: "Offer" },
  { value: "under_contract", label: "Under contract" },
  { value: "on_hold", label: "On hold / timing" },
  { value: "passed", label: "Passed" },
] as const;

export const PROSPECT_SOURCES = [
  { value: "loopnet", label: "LoopNet" },
  { value: "crexi", label: "Crexi" },
  { value: "costar", label: "CoStar" },
  { value: "prospect_sheet", label: "Prospect Sheet" },
  { value: "inbound_email", label: "Inbound email" },
  { value: "inbound_call", label: "Inbound call" },
  { value: "sign_call", label: "Sign call" },
  { value: "broker", label: "Broker" },
  { value: "referral", label: "Referral" },
  { value: "other", label: "Other" },
] as const;

export const CAMPAIGN_STATUSES = [
  { value: "sent", label: "Sent" },
  { value: "told_other", label: "Told another way" },
  { value: "not_sent", label: "Not sent" },
  { value: "bounced", label: "Bounced" },
] as const;

/** Quick-log buttons on the checklist row. `type` is the activity_type written. */
export const QUICK_LOG = [
  { key: "call", label: "Call", type: "Call" },
  { key: "text", label: "Text", type: "Text" },
  { key: "lm", label: "LM", type: "Call – left message" },
  { key: "no_answer", label: "No answer", type: "Call – no answer" },
  { key: "talked", label: "Talked", type: "Call – talked" },
  { key: "pass", label: "Pass", type: "Passed" },
] as const;
export type QuickLogKey = (typeof QUICK_LOG)[number]["key"];

export const stageLabel = (v: string | null) =>
  PROSPECT_STAGES.find((s) => s.value === v)?.label ?? (v ? v : "—");
export const sourceLabel = (v: string | null) =>
  PROSPECT_SOURCES.find((s) => s.value === v)?.label ?? (v ? v : "—");
export const campaignStatusLabel = (v: string | null) =>
  CAMPAIGN_STATUSES.find((s) => s.value === v)?.label ?? "—";

/** Same test as the DB's is_buyer_prospect(). */
export function isBuyerProspect(partySide: string | null, role: string | null): boolean {
  if (partySide !== "counterparty") return false;
  const r = (role ?? "").toLowerCase();
  return r.includes("prospect") || r.includes("buyer");
}

/**
 * A phone touch — what "called" means on the checklist. A text counts (the
 * spreadsheet's "Called?" was Yes for a text-only follow-up), an email doesn't.
 */
export function isPhoneTouch(activityType: string | null): boolean {
  const t = (activityType ?? "").toLowerCase();
  return /\b(call|called|text|texted|lm|left message|voicemail|vm|no answer|talked)\b/.test(t);
}

export type Campaign = { id: string; name: string; sent_on: string | null; notes: string | null };
