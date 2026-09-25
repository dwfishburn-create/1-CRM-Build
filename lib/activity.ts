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
  if (activity_date) {
    row.activity_date = /^\d{4}-\d{2}-\d{2}$/.test(activity_date)
      ? `${activity_date}T12:00:00-05:00`
      : activity_date;
  }

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
