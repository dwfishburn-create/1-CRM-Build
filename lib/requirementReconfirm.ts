import { supabase } from "./supabase";
import { nextDisplayCode } from "./displayCode";
import { cancelTask } from "./tasks";
import {
  TARGET_MARKETS,
  parseChoice,
  parseChoiceArray,
  parseDate,
  type Choice,
} from "./retailBrands";

// Requirement expansion-signal fields and the re-confirm task (10/13/2026,
// migration 026). Used by both POST/PATCH /api/agent/requirements and the web
// actions under app/requirements, so the rule lives in one place.
//
// Why: the 9/22/2026 decision — a requirement captured from a vague signal
// ("they're looking at Lincoln next year") needs a confidence, a source date
// and a re-confirm date, so it surfaces on the Dashboard instead of going
// stale. The Dashboard reads open tasks, so the re-confirm date becomes ONE
// open task (category 'reconfirm', linked by tasks.requirement_id) that is
// kept in step with the requirement:
//
//   active + reconfirm_date   → exactly one open reconfirm task, due that date
//                               (created if missing, re-dated if it moved)
//   date cleared, or the requirement leaves 'active'
//                             → the open reconfirm task is cancelled (the row
//                               is kept — cancelTask, not delete)
//
// A completed reconfirm task is history and is never touched.

export const CONFIDENCE: Choice[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const RECONFIRM_CATEGORY = "reconfirm";

export const SIGNAL_FIELDS = ["confidence", "source_date", "reconfirm_date", "target_markets"] as const;

/**
 * Validate whichever of the four signal fields are present in `input`
 * (PATCH semantics: absent fields are not in the result). "" clears.
 * Throws RetailBrandError (400) naming the allowed values.
 */
export function parseSignalFields(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const has = (k: string) => k in input && input[k] !== undefined;
  if (has("confidence")) out.confidence = parseChoice(CONFIDENCE, "confidence", input.confidence);
  if (has("source_date")) out.source_date = parseDate("source_date", input.source_date);
  if (has("reconfirm_date")) out.reconfirm_date = parseDate("reconfirm_date", input.reconfirm_date);
  if (has("target_markets")) {
    out.target_markets = parseChoiceArray(TARGET_MARKETS, "target_markets", input.target_markets);
  }
  return out;
}

/** The four fields as the web forms post them; markets are checkboxes, so getAll. */
export function signalFieldsFromForm(fd: FormData): Record<string, unknown> {
  return parseSignalFields({
    confidence: String(fd.get("confidence") ?? ""),
    source_date: String(fd.get("source_date") ?? ""),
    reconfirm_date: String(fd.get("reconfirm_date") ?? ""),
    target_markets: fd.getAll("target_markets").map((v) => String(v)),
  });
}

export type ReconfirmResult = {
  action: "created" | "redated" | "unchanged" | "cancelled" | "none";
  task_id?: string;
  due_date?: string;
};

type ReqRow = {
  id: string;
  display_code: string | null;
  deal_type: string | null;
  property_type: string | null;
  status: string;
  reconfirm_date: string | null;
  confidence: string | null;
  source_date: string | null;
};

type PartyEntity = { id: string; name: string; trade_name: string | null; retail_brands: { id: string }[] | { id: string } | null };

/** Brand (preferred) or first linked entity, else the requirement's own label. */
async function labelFor(r: ReqRow): Promise<{ label: string; entity_id: string | null }> {
  const { data } = await supabase
    .from("requirement_parties")
    .select("entity:entities!entity_id(id, name, trade_name, retail_brands(id))")
    .eq("requirement_id", r.id)
    .not("entity_id", "is", null)
    .order("created_at", { ascending: true });
  const entities = (data ?? [])
    .map((p) => (Array.isArray(p.entity) ? p.entity[0] : p.entity) as PartyEntity | null)
    .filter((e): e is PartyEntity => !!e);
  const isBrand = (e: PartyEntity) =>
    Array.isArray(e.retail_brands) ? e.retail_brands.length > 0 : !!e.retail_brands;
  const pick = entities.find(isBrand) ?? entities[0] ?? null;
  if (pick) return { label: pick.trade_name || pick.name, entity_id: pick.id };
  const kind = [r.deal_type, r.property_type].filter(Boolean).join(", ");
  return { label: `${r.display_code ?? "requirement"}${kind ? ` (${kind})` : ""}`, entity_id: null };
}

/**
 * Bring the requirement's open reconfirm task in line with its status and
 * reconfirm_date. Call after the requirement row is saved.
 *
 * createIfMissing: false only re-titles / re-dates / cancels an existing open
 * task and never creates one. Callers pass false when the save did not touch
 * status or reconfirm_date (an edit to `details` must not resurrect a reconfirm
 * Dan already completed) and after linking a party (to pick up the brand name).
 */
export async function syncReconfirmTask(
  requirementId: string,
  opts: { createIfMissing?: boolean } = {}
): Promise<ReconfirmResult> {
  const createIfMissing = opts.createIfMissing ?? true;

  const { data: r, error } = await supabase
    .from("requirements")
    .select("id, display_code, deal_type, property_type, status, reconfirm_date, confidence, source_date")
    .eq("id", requirementId)
    .maybeSingle()
    .returns<ReqRow | null>();
  if (error) throw new Error(error.message);
  if (!r) throw new Error("Requirement not found.");

  const { data: open, error: openErr } = await supabase
    .from("tasks")
    .select("id, title, due_date, entity_id")
    .eq("requirement_id", r.id)
    .eq("category", RECONFIRM_CATEGORY)
    .eq("status", "open")
    .order("created_at", { ascending: true });
  if (openErr) throw new Error(openErr.message);
  const openTasks = open ?? [];

  const wanted = r.status === "active" && !!r.reconfirm_date;

  if (!wanted) {
    for (const t of openTasks) await cancelTask(t.id);
    return { action: openTasks.length ? "cancelled" : "none" };
  }

  const due = r.reconfirm_date as string;
  const { label, entity_id } = await labelFor(r);
  const title = `Re-confirm: ${label}`;

  // Exactly one: keep the oldest, cancel any others.
  const [keep, ...extra] = openTasks;
  for (const t of extra) await cancelTask(t.id);

  if (keep) {
    const patch: Record<string, unknown> = {};
    if (keep.due_date !== due) patch.due_date = due;
    if (keep.title !== title) patch.title = title;
    if (entity_id && keep.entity_id !== entity_id) patch.entity_id = entity_id;
    if (Object.keys(patch).length === 0) return { action: "unchanged", task_id: keep.id, due_date: due };
    patch.updated_at = new Date().toISOString();
    const { error: upErr } = await supabase.from("tasks").update(patch).eq("id", keep.id);
    if (upErr) throw new Error(upErr.message);
    return { action: patch.due_date ? "redated" : "unchanged", task_id: keep.id, due_date: due };
  }

  if (!createIfMissing) return { action: "none" };

  const facts = [
    r.confidence && `confidence ${r.confidence}`,
    r.source_date && `heard ${r.source_date}`,
  ].filter(Boolean);
  const description =
    `Re-confirm ${r.display_code ?? "requirement"} with ${label}: is it still active, ` +
    `and have the size, markets or timing changed?` +
    (facts.length ? ` (${facts.join(", ")})` : "") +
    ` Update the requirement's reconfirm date (or status) when done.`;

  const display_code = await nextDisplayCode("tasks", "TASK");
  const { data: task, error: insErr } = await supabase
    .from("tasks")
    .insert({
      display_code,
      title,
      description,
      due_date: due,
      status: "open",
      category: RECONFIRM_CATEGORY,
      requirement_id: r.id,
      entity_id,
    })
    .select("id")
    .single();
  if (insErr) throw new Error(insErr.message);
  return { action: "created", task_id: task.id, due_date: due };
}

/**
 * Run the sync without letting it fail the save that triggered it: the
 * requirement is already written, so a task problem comes back as a warning
 * (the same contract as an activity's follow-up task in lib/activity.ts).
 */
export async function syncReconfirmTaskSafe(
  requirementId: string,
  opts: { createIfMissing?: boolean } = {}
): Promise<{ reconfirm_task?: ReconfirmResult; reconfirm_warning?: string }> {
  try {
    return { reconfirm_task: await syncReconfirmTask(requirementId, opts) };
  } catch (e) {
    return {
      reconfirm_warning:
        "Requirement saved, but its re-confirm task was not updated: " +
        (e instanceof Error ? e.message : String(e)) +
        " — the re-confirm date will NOT appear on the Dashboard until it is.",
    };
  }
}
