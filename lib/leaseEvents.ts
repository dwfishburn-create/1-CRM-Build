import { supabase } from "./supabase";

/**
 * Marks a lease event done (option notice sent, TI funds disbursed, etc.).
 * Shared by the Dashboard Server Action so the write lives in one place,
 * matching the lib/tasks.ts pattern. No recurrence concept here — unlike
 * tasks, a completed lease event doesn't spin up a next occurrence.
 */
export async function completeLeaseEvent(leaseEventId: string): Promise<void> {
  const { error } = await supabase
    .from("lease_events")
    .update({ is_completed: true, updated_at: new Date().toISOString() })
    .eq("id", leaseEventId);

  if (error) throw new Error(error.message);
}
