import { supabase } from "./supabase";

/**
 * Generates the next human-readable display code for a table, e.g. PROP-0001.
 *
 * Derived from the HIGHEST existing code, not the row count.
 *
 * It was count + 1 from 8/23/2026 until 9/15/2026, which was safe only while
 * rows were never removed. Migration 014 added delete_contact and
 * merge_contacts, making removal a normal operation for the first time — and
 * count + 1 after a delete points straight at a number that is already in
 * use, so the next insert either collides with the `display_code text unique`
 * constraint or, if the colliding row was the one deleted, quietly reissues a
 * code that still appears in notes, emails and exported lists as a different
 * person. Taking max + 1 means a retired code stays retired.
 *
 * Two known limits, both acceptable for a single-user tool and both unchanged
 * from the previous implementation:
 *   - Not safe against concurrent inserts; two simultaneous calls can read
 *     the same max. A Postgres sequence per prefix is the fix if this ever
 *     goes multi-user.
 *   - Ordering is lexical, which is correct only while the numeric part stays
 *     four digits ("CON-9999" sorts above "CON-10000"). At ~64 contacts that
 *     is thousands of records away; revisit with the sequence change.
 */
export async function nextDisplayCode(
  table: string,
  prefix: string
): Promise<string> {
  const { data, error } = await supabase
    .from(table)
    .select("display_code")
    .like("display_code", `${prefix}-%`)
    .order("display_code", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);

  const highest = data?.[0]?.display_code as string | null | undefined;
  const parsed = highest ? Number.parseInt(highest.slice(prefix.length + 1), 10) : 0;
  const n = (Number.isFinite(parsed) ? parsed : 0) + 1;

  return `${prefix}-${String(n).padStart(4, "0")}`;
}
