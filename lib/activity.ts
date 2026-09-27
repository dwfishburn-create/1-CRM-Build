import { supabase } from "./supabase";
import { nextDisplayCode } from "./displayCode";
import type { Provenance } from "./provenance";

// Logging an activity, in one place (9/24/2026, fifth pass).
//
// Until now the only way to log an activity was POST /api/agent/activity-log,
// which meant every routine update — "called him, he'll get back to me
// Monday" — needed a Claude session. The web form on the record pages writes
// through this same function, so the rule migration 018 introduced cannot
// drift between the two paths:
//
//   the activity is the HISTORY of what was agreed; the task is the QUEUE.
//   A next step WITH a due date becomes a task. Without a date it stays a note.
//
// New here: waiting_on_contact_id. The auto-task used to be "Your move"
// unconditionally, so putting the ball in the other party's court took a
// second call. Now the follow-up can be created already waiting on someone,
// which is what moves it to the Dashboard's Waiting On column.

export type LogActivityInput = {
  activity_type: string;
  project_id?: string | null;
  property_id?: string | null;
  contact_id?: string | null;
  entity_id?: string | null;
  activity_date?: string | null;
  performed_by?: string | null;
  summary?: string | null;
  next_step?: string | null;
  next_step_due_date?: string | null;
  waiting_on_contact_id?: string | null;
  client_visible?: boolean;
  source?: string | null;
  create_task_from_next_step?: boolean;
  provenance?: Provenance;
};

export type LogActivityResult = {
  activity: Record<string, unknown>;
  task?: Record<string, unknown>;
  task_warning?: string;
};

// A bare date from the web form ("2026-09-24") is stored as noon Central
// rather than midnight UTC, so it does not display as the previous day.
function normalizeActivityDate(v: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00-05:00` : v;
}

function clean(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export async function logActivity(input: LogActivityInput): Promise<LogActivityResult> {
  const activity_type = clean(input.activity_type);
  if (!activity_type) throw new Error("activity_type is required.");

  const project_id = clean(input.project_id);
  const property_id = clean(input.property_id);
  const contact_id = clean(input.contact_id);
  const entity_id = clean(input.entity_id);
  const next_step = clean(input.next_step);
  const next_step_due_date = clean(input.next_step_due_date);
  const waiting_on_contact_id = clean(input.waiting_on_contact_id);
  const activity_date = clean(input.activity_date);

  const display_code = await nextDisplayCode("activity_log", "LOG");

  const row: Record<string, unknown> = {
    ...(input.provenance ?? {}),
    display_code,
    activity_type,
    project_id,
    property_id,
    contact_id,
    entity_id,
    performed_by: clean(input.performed_by),
    summary: clean(input.summary),
    next_step,
    next_step_due_date,
    client_visible: Boolean(input.client_visible),
    source: clean(input.source) ?? "agent_api",
  };
  // Only set activity_date when supplied — otherwise the column default (now())
  // applies. A bare date from the web form ("2026-09-24") is stored as noon
  // Central rather than midnight UTC, so it does not display as the previous day.
  if (activity_date) row.activity_date = normalizeActivityDate(activity_date);

  const { data: activity, error } = await supabase
    .from("activity_log")
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);

  const wantsTask = input.create_task_from_next_step ?? true;
  if (!wantsTask || !next_step || !next_step_due_date) {
    return { activity };
  }

  // If the task insert fails the activity is still returned — the log entry
  // is the record of what happened and must not be lost because a convenience
  // failed. The caller is told, rather than failing silently.
  const taskCode = await nextDisplayCode("tasks", "TASK");
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      display_code: taskCode,
      description: next_step,
      due_date: next_step_due_date,
      status: "open",
      category: activity_type,
      project_id,
      property_id,
      contact_id,
      entity_id,
      waiting_on_contact_id,
      source_activity_id: activity.id,
    })
    .select()
    .single();

  if (taskError) {
    return {
      activity,
      task_warning:
        "Activity saved, but the follow-up task was not created: " +
        taskError.message +
        " — this next step will NOT appear on the Dashboard.",
    };
  }
  return { activity, task };
}

// ---------------------------------------------------------------------------
// Correcting an activity (9/27/2026, migration 021)
//
// The activity log is the record of what happened and when — the evidence in
// a procuring-cause or first-introduction question — so an edit never
// overwrites silently: update_activity() in Postgres writes one
// activity_log_edits row per field that actually changed (old value, new
// value, when, from where) in the same transaction, and stamps edited_at.
//
// Next steps: the activity records what was agreed; the task is the live
// queue. So an edit does NOT re-date or reword a follow-up task that already
// exists — use update_task for that. The one exception is a next step that
// never became a task (it had no date): once an edit gives it both a next
// step and a date, the task is created, exactly as logging it that way would
// have done.
// ---------------------------------------------------------------------------

export const ACTIVITY_EDITABLE_FIELDS = [
  "activity_type",
  "activity_date",
  "performed_by",
  "summary",
  "next_step",
  "next_step_due_date",
  "client_visible",
  "contact_id",
  "entity_id",
  "project_id",
  "property_id",
] as const;

export type ActivityPatch = Partial<
  Record<(typeof ACTIVITY_EDITABLE_FIELDS)[number], string | boolean | null>
>;

export type UpdateActivityResult = {
  activity: Record<string, unknown>;
  changed: string[];
  task?: Record<string, unknown>;
  linked_task?: Record<string, unknown>;
  note?: string;
  task_warning?: string;
};

export class ActivityEditError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function updateActivity(
  id: string,
  patch: ActivityPatch,
  options: { source?: string; waiting_on_contact_id?: string | null } = {}
): Promise<UpdateActivityResult> {
  const body: Record<string, unknown> = {};
  for (const key of ACTIVITY_EDITABLE_FIELDS) {
    if (!(key in patch)) continue;
    const raw = patch[key];
    if (key === "client_visible") {
      body[key] = raw === true || raw === "true";
      continue;
    }
    const v = raw === null || raw === undefined ? "" : String(raw).trim();
    body[key] = key === "activity_date" && v ? normalizeActivityDate(v) : v;
  }
  if (Object.keys(body).length === 0) {
    throw new ActivityEditError("No fields to update.", 400);
  }

  const { data, error } = await supabase.rpc("update_activity", {
    p_id: id,
    p_patch: body,
    p_source: options.source ?? "agent_api",
  });
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "22023" || error.code === "22P02" || error.code === "22007" || error.code === "22008" ? 400 : 500;
    throw new ActivityEditError(error.message, status);
  }

  const result = data as { activity: Record<string, unknown>; changed: string[] };
  const activity = result.activity;
  const out: UpdateActivityResult = { activity, changed: result.changed ?? [] };

  const nextStep = clean(activity.next_step);
  const nextDate = clean(activity.next_step_due_date);
  const touchedNextStep = out.changed.some((f) => f === "next_step" || f === "next_step_due_date");

  const { data: tasks, error: taskLookupError } = await supabase
    .from("tasks")
    .select("id, display_code, title, description, due_date, status, waiting_on_contact_id")
    .eq("source_activity_id", id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (taskLookupError) {
    out.task_warning = `Activity updated, but its follow-up task could not be checked: ${taskLookupError.message}`;
    return out;
  }
  const linked = tasks?.[0];

  if (linked) {
    out.linked_task = linked;
    if (touchedNextStep && linked.status === "open") {
      out.note =
        `The follow-up task ${linked.display_code} was NOT changed — the activity records ` +
        `what was agreed, the task is the live queue. Use update_task to re-date or reword it.`;
    }
    return out;
  }

  if (touchedNextStep && nextStep && nextDate) {
    const taskCode = await nextDisplayCode("tasks", "TASK");
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .insert({
        display_code: taskCode,
        description: nextStep,
        due_date: nextDate,
        status: "open",
        category: clean(activity.activity_type),
        project_id: clean(activity.project_id),
        property_id: clean(activity.property_id),
        contact_id: clean(activity.contact_id),
        entity_id: clean(activity.entity_id),
        waiting_on_contact_id: clean(options.waiting_on_contact_id),
        source_activity_id: id,
      })
      .select()
      .single();
    if (taskError) {
      out.task_warning =
        "Activity updated, but the follow-up task was not created: " +
        taskError.message +
        " — this next step will NOT appear on the Dashboard.";
    } else {
      out.task = task;
    }
  }
  return out;
}
