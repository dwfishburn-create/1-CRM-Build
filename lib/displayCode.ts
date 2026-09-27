import { supabase } from "./supabase";

/**
 * Generates the next human-readable display code for a table, e.g. PROP-0001.
 *
 * As of 9/27/2026 (migration 021) this is a per-prefix counter in Postgres
 * (`next_display_code`), not max + 1 computed here.
 *
 * History, because each version fixed the previous one's failure:
 *   - 8/23/2026–9/15/2026: count + 1. Broke once rows could be deleted — the
 *     next insert pointed at a number already in use.
 *   - 9/15/2026–9/27/2026: max + 1. A retired code stayed retired UNLESS it
 *     was the highest one, which is the usual case (the duplicate is almost
 *     always the row just created). Observed 9/24/2026: PROP-0061 was merged
 *     away and reissued to a different property four seconds later.
 *   - Now: a counter that only ever increments. It also takes a row lock, so
 *     two simultaneous inserts no longer read the same value, and compares
 *     numbers rather than text, so CON-10000 is handled correctly.
 *
 * The counter never falls behind the table: if a row was inserted with a code
 * it didn't issue (a hand-run SQL load), the next call jumps past it.
 */
export async function nextDisplayCode(
  table: string,
  prefix: string
): Promise<string> {
  const { data, error } = await supabase.rpc("next_display_code", {
    p_table: table,
    p_prefix: prefix,
  });

  if (error) throw new Error(`Could not issue a ${prefix} display code: ${error.message}`);
  if (typeof data !== "string" || !data.startsWith(`${prefix}-`)) {
    throw new Error(`Could not issue a ${prefix} display code: unexpected response.`);
  }
  return data;
}
